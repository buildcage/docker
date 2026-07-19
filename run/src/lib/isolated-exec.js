import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync, readFileSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { buildDockerCpArgs } from "./container.js";
// Sensitive /proc paths masked with /dev/null. runc's own `runc spec`
// default already masks /proc/kcore, /proc/keys, and /proc/timer_list
// (among others) and leaves /proc/sysrq-trigger merely read-only —
// buildOciConfig upgrades sysrq-trigger to fully masked (moving it out of
// readonlyPaths) and adds kallsyms/kmsg, which runc's default doesn't
// cover at all.
//
// Imported from a shared JSON file (rather than a JS literal) so run/dev's
// build-test-bundle.sh — a bash/jq stand-in for this same function, used
// by the Mac dev loop — has a single source of truth to read the same
// list from instead of hand-duplicating it.
import EXTRA_MASKED_PROC_PATHS from "../../scripts/extra-masked-proc-paths.json" with { type: "json" };

// rollup's cjs output doesn't convert import.meta.dirname (it silently
// becomes undefined), so use this form instead.
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Write the user-supplied `run:` input to an executable script file.
 * Routing through a file (rather than passing the command inline to a
 * shell) avoids any shell-injection surface from the input string.
 */
export function writeRunScript(runInput, dir) {
  const scriptPath = join(dir, "run-script.sh");
  const content = runInput.startsWith("#!") ? runInput : `#!/bin/sh\nset -e\n${runInput}\n`;
  writeFileSync(scriptPath, content, { mode: 0o700 });
  return scriptPath;
}

/**
 * Generate runc's own default OCI bundle config via `runc spec` (run in
 * `bundleDir`, which is where it writes `config.json`). Used as the
 * starting point for buildOciConfig rather than hand-writing the full
 * spec from scratch, so the baseline mounts/masked-paths/rlimits stay
 * exactly what runc itself considers a sane default for its own version,
 * and buildOciConfig only needs to override/extend the handful of fields
 * this sandbox actually cares about.
 */
export function generateBaseOciSpec(runcPath, bundleDir) {
  execFileSync(runcPath, ["spec"], { cwd: bundleDir });
  return JSON.parse(readFileSync(join(bundleDir, "config.json"), "utf8"));
}

/**
 * Extract runc and gen-seccomp-profile from the proxy image into this run's
 * own `destDir` (its per-step scratch dir), then resolve the base OCI spec
 * and the seccomp profile from them. Run once per `run:` step; each
 * invocation is independent, and everything written here is torn down with
 * the scratch dir (see withScratchDir).
 *
 * Both binaries ship inside the proxy image and are pulled onto the host via
 * `docker cp`, then run natively there (not `docker exec`) since the seccomp
 * profile's content depends on the real host kernel/arch -- see
 * gen-seccomp-profile/main.go. gen-seccomp-profile is only needed transiently
 * to resolve the profile, so it's removed once read; runc stays for `runc run`.
 */
export function extractRuncBootstrap({ containerName, destDir }) {
  const runcPath = join(destDir, "runc");
  const genSeccompProfilePath = join(destDir, "gen-seccomp-profile");
  execFileSync("docker", buildDockerCpArgs({ containerName, containerPath: "/opt/buildcage/bin/runc", hostPath: runcPath }));
  execFileSync(
    "docker",
    buildDockerCpArgs({ containerName, containerPath: "/opt/buildcage/bin/gen-seccomp-profile", hostPath: genSeccompProfilePath }),
  );
  chmodSync(runcPath, 0o755);
  chmodSync(genSeccompProfilePath, 0o755);
  const seccompProfile = JSON.parse(execFileSync(genSeccompProfilePath, { encoding: "utf8" }));
  const baseSpec = generateBaseOciSpec(runcPath, destDir); // writes config.json into destDir (overwritten later by writeOciConfig)
  rmSync(genSeccompProfilePath); // only needed to resolve seccompProfile above

  return { runcPath, seccompProfile, baseSpec };
}

/**
 * Pure: extract {mountPoint, fsType} for every line of raw
 * /proc/self/mountinfo content. Format (space-separated fields):
 *   ID PARENT-ID MAJOR:MINOR ROOT MOUNT-POINT OPTIONS [OPT-FIELDS...] - FSTYPE SOURCE SUPER-OPTIONS
 * The mount point is always field 5 (index 4); the filesystem type is
 * always the field right after the literal "-" separator, regardless of
 * how many optional fields precede it.
 */
export function parseMountinfo(mountinfoContent) {
  return mountinfoContent
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const fields = line.split(" ");
      const dashIndex = fields.indexOf("-");
      return { mountPoint: fields[4], fsType: fields[dashIndex + 1] };
    });
}

/**
 * Reads the real host mount table. Node runs directly on the runner host,
 * not inside any namespace, so this is exactly the mount table
 * run-isolated.sh's `mount --rbind /` will duplicate into rootfsBindDir a
 * moment later (see buildOciConfig's readonlyPaths handling for why this
 * matters).
 */
export function listHostMounts() {
  return parseMountinfo(readFileSync("/proc/self/mountinfo", "utf8"));
}

/**
 * Pseudo-filesystems tolerated as-is (not forced read-only): each of these
 * gets its own fresh, namespace-scoped mount from runc's own default
 * `mounts` entries (or from `linux.maskedPaths`/`namespaces` handling)
 * rather than being read from the host-root bind-mount at all, so forcing
 * the host-side copy read-only would be meaningless (and some reject a
 * read-only remount outright).
 */
const TOLERATED_PSEUDO_FSTYPES = new Set([
  "proc",
  "procfs",
  "sysfs",
  "cgroup",
  "cgroup2",
  "devpts",
  "mqueue",
  "debugfs",
  "tracefs",
  "securityfs",
  "pstore",
  "bpf",
  "configfs",
  "fusectl",
  "hugetlbfs",
  "binfmt_misc",
  "autofs",
  "efivarfs",
  "nsfs",
  "rpc_pipefs",
]);

/**
 * Pure: given the host's real mount table and the set of paths that must
 * stay writable, return the host mount points that need to be explicitly
 * forced read-only. This exists because `root.readonly` in OCI/runc only
 * remounts the top-level rootfs mount point — it does *not* recursively
 * apply to separate mount points that `mount --rbind /` duplicates into
 * the sandbox's rootfs. Any real (non-pseudo) host mount point not
 * covered by this list would otherwise remain fully writable despite the
 * sandbox's documented read-only-outside-workdir/home/tmp/writable
 * guarantee. "/" itself is excluded since root.readonly already covers
 * it directly.
 */
export function computeReadonlyHostMounts(hostMounts, protectedPaths) {
  return hostMounts
    .filter(({ mountPoint, fsType }) => mountPoint !== "/" && !TOLERATED_PSEUDO_FSTYPES.has(fsType) && !protectedPaths.has(mountPoint))
    .map(({ mountPoint }) => mountPoint);
}

/**
 * Build the final OCI Runtime Spec (config.json) for the isolated command,
 * starting from runc's own `baseSpec` (see generateBaseOciSpec) and
 * overriding only what this sandbox needs to control:
 *
 * - root: a bind-mounted copy of the host's own `/` (rootfsBindDir, set up
 *   by run-isolated.sh before invoking runc — pivot_root can't target `/`
 *   itself), made read-only via `root.readonly` plus an explicit
 *   `linux.readonlyPaths` entry per real host mount point `--rbind`
 *   duplicated in (see computeReadonlyHostMounts — root.readonly alone
 *   only covers the top-level mount), except workdir/home/tmp/writablePaths.
 * - linux.namespaces: same six namespace types runc's own default spec
 *   already requests (no user namespace — see docs/security.md's
 *   rationale for preserving the real UID/GID), just adding `path` to the
 *   network entry so it joins the netns run-isolated.sh already wired a
 *   veth into, instead of creating a fresh, unconnected one.
 * - process.capabilities: fully cleared (all five sets empty) plus
 *   noNewPrivileges — runc applies this natively, no setpriv needed.
 * - process.env: the step's real environment, replacing runc spec's
 *   invented PATH/TERM defaults.
 * - linux.seccomp: the Docker-default-profile-derived filter (see
 *   gen-seccomp-profile), resolved against this same empty capability
 *   set.
 *
 * `writablePaths` containing "/" is a sentinel meaning "disable the
 * read-only restriction entirely" (see docs/reference.md's `writable`
 * input).
 */
export function buildOciConfig(
  baseSpec,
  { uid, gid, workdir, home, writablePaths = [], env, netnsPath, rootfsBindDir, resolvConfPath, seccompProfile, scriptPath, hostMounts = [] },
) {
  const disableReadonly = writablePaths.includes("/");

  const mounts = [...baseSpec.mounts, { destination: "/etc/resolv.conf", type: "none", source: resolvConfPath, options: ["rbind", "ro"] }];
  const protectedPaths = new Set([workdir, home, "/tmp", ...writablePaths].filter(Boolean));
  if (!disableReadonly) {
    if (workdir) mounts.push({ destination: workdir, type: "none", source: workdir, options: ["rbind", "rw"] });
    if (home) mounts.push({ destination: home, type: "none", source: home, options: ["rbind", "rw"] });
    mounts.push({ destination: "/tmp", type: "none", source: "/tmp", options: ["rbind", "rw"] });
    for (const p of writablePaths) mounts.push({ destination: p, type: "none", source: p, options: ["rbind", "rw"] });
  }

  const maskedPaths = [...(baseSpec.linux.maskedPaths ?? []), ...EXTRA_MASKED_PROC_PATHS];
  const baseReadonlyPaths = (baseSpec.linux.readonlyPaths ?? []).filter((p) => !EXTRA_MASKED_PROC_PATHS.includes(p));
  const readonlyPaths = disableReadonly
    ? baseReadonlyPaths
    : Array.from(new Set([...baseReadonlyPaths, ...computeReadonlyHostMounts(hostMounts, protectedPaths)]));

  const namespaces = baseSpec.linux.namespaces.map((ns) => (ns.type === "network" ? { ...ns, path: netnsPath } : ns));

  return {
    ...baseSpec,
    root: { path: rootfsBindDir, readonly: !disableReadonly },
    mounts,
    process: {
      ...baseSpec.process,
      terminal: false,
      user: { uid, gid },
      // setpriv --pdeathsig ties this process's life to its direct
      // parent's -- the `runc run` process, not run-isolated.sh itself
      // (runc's own process sits in between). This is the second hop of a
      // two-hop chain: run-isolated.sh also wraps its own `runc run`
      // invocation in `setpriv --pdeathsig=KILL` (targeting itself), so if
      // run-isolated.sh is SIGKILL'd, `runc run` dies too, which then
      // kills this process in turn -- without the outer hop, `runc run`
      // would merely become an orphan (still alive) and this process,
      // whose parent never actually died, would never receive anything.
      // No other setpriv flags are needed here -- uid/gid, capabilities,
      // and no_new_privs are already applied by runc itself (above/below)
      // before this execs.
      args: ["setpriv", "--pdeathsig=KILL", "--", scriptPath],
      env: Object.entries(env)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${v}`),
      cwd: workdir || "/",
      capabilities: { bounding: [], effective: [], permitted: [], inheritable: [], ambient: [] },
      noNewPrivileges: true,
    },
    linux: {
      ...baseSpec.linux,
      namespaces,
      seccomp: seccompProfile,
      maskedPaths,
      readonlyPaths,
    },
  };
}

/**
 * Write the final OCI config to `bundleDir/config.json` (overwriting the
 * `runc spec` placeholder generateBaseOciSpec left there). Mode 0600:
 * `process.env` embeds the whole step environment, including any secrets
 * passed via `env:`.
 */
export function writeOciConfig(config, bundleDir) {
  const configPath = join(bundleDir, "config.json");
  writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
  return configPath;
}

/** Write the resolv.conf bind-mount source referenced by buildOciConfig. */
export function writeResolvConf(dns, dir) {
  const resolvConfPath = join(dir, "resolv.conf");
  writeFileSync(resolvConfPath, `nameserver ${dns}\n`, { mode: 0o644 });
  return resolvConfPath;
}

/**
 * Run the user's command inside the isolated sandbox via run-isolated.sh
 * (invoked with `sudo -n`, since setting up namespaces/veth/iptables/the
 * rootfs bind-mount requires root). Returns the exit code of the isolated
 * command — never throws for a non-zero exit, since that's the user's
 * command failing, not this function.
 *
 * uid/gid, capabilities, mounts, and env are entirely described by
 * `config.json` (see buildOciConfig) — run-isolated.sh only needs enough
 * to set up networking and the rootfs bind-mount before handing off to
 * `runc run`.
 */
export function runIsolated({ runcPath, proxyPid, bundleDir, containerId, netnsName, rootfsBindDir, gateway, dns, targetIp }) {
  const runIsolatedShPath = join(__dirname, "..", "scripts", "run-isolated.sh");

  const args = [
    "-n",
    "--",
    runIsolatedShPath,
    "--proxy-pid",
    String(proxyPid),
    "--runc",
    runcPath,
    "--bundle",
    bundleDir,
    "--container-id",
    containerId,
    "--netns-name",
    netnsName,
    "--rootfs-bind-dir",
    rootfsBindDir,
    "--gateway",
    gateway,
    "--dns",
    dns,
    "--target-ip",
    targetIp,
  ];

  try {
    execFileSync("sudo", args, { stdio: "inherit" });
    return 0;
  } catch (e) {
    // A non-zero exit from the isolated command (or run-isolated.sh itself)
    // surfaces here as an ExecException; e.status is the actual exit code.
    // e.status is null if the process was killed by a signal.
    return typeof e.status === "number" ? e.status : 1;
  }
}

/**
 * Pure: mount points from raw /proc/self/mountinfo content that are
 * nested under `dir` (including `dir` itself), deepest-path-first so a
 * caller can safely unmount children before their parents.
 */
export function parseMountsUnder(mountinfoContent, dir) {
  const prefix = dir.endsWith("/") ? dir : `${dir}/`;
  return parseMountinfo(mountinfoContent)
    .map(({ mountPoint }) => mountPoint)
    .filter((mountPoint) => mountPoint === dir || mountPoint.startsWith(prefix))
    .sort((a, b) => b.length - a.length);
}

/**
 * Force-detaches any mount points still nested under `dir` before it's
 * recursively deleted. This is the safety net for rootfsBindDir (a
 * `mount --rbind /` of the entire host filesystem — see main.js) surviving
 * past run-isolated.sh's own cleanup trap: if that trap never runs (e.g.
 * run-isolated.sh itself is SIGKILL'd, which bypasses traps entirely) or
 * its `umount -R` fails (EBUSY), a plain recursive delete of `dir` would
 * otherwise walk straight through the still-live bind-mount and delete
 * the real files on the host it points at, not a sandboxed copy. `-l`
 * (lazy) detaches each mount from the namespace immediately regardless of
 * busy references, so this step itself can't hang or fail the way a
 * normal (non-lazy) unmount could.
 */
function unmountAllUnder(dir) {
  let mountPoints;
  try {
    mountPoints = parseMountsUnder(readFileSync("/proc/self/mountinfo", "utf8"), dir);
  } catch {
    return;
  }
  for (const mountPoint of mountPoints) {
    try {
      execFileSync("sudo", ["umount", "-R", "-l", mountPoint], { stdio: ["ignore", "ignore", "pipe"] });
    } catch (e) {
      console.log(`::warning::Failed to unmount ${mountPoint} before cleanup: ${e.message}`);
    }
  }
}

/**
 * Removes the scratch dir, retrying on EBUSY. A lazy unmount (see
 * unmountAllUnder) detaches a mount from the path-resolution tree
 * immediately -- it stops appearing in /proc/self/mountinfo right away --
 * but the kernel's underlying teardown of that now-orphaned mount can
 * still lag behind by a short, bounded window, which can make a
 * directory rmSync is about to delete spuriously report EBUSY even
 * though it's no longer listed as a mountpoint at all. Resolves on the
 * very next attempt after a brief wait.
 */
function removeScratchDir(dir) {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (e) {
      if (e.code !== "EBUSY" || attempt === maxAttempts) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
}

/** Create/remove a scratch directory for this step's OCI bundle + run-script. */
export function withScratchDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "buildcage-sandbox-"));
  try {
    return fn(dir);
  } finally {
    unmountAllUnder(dir);
    removeScratchDir(dir);
  }
}

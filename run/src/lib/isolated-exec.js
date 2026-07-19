import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

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
 * Sensitive /proc paths masked with /dev/null, matching the previous
 * unshare-based implementation. runc's own `runc spec` default already
 * masks /proc/kcore, /proc/keys, and /proc/timer_list (among others) and
 * leaves /proc/sysrq-trigger merely read-only — buildOciConfig upgrades
 * sysrq-trigger to fully masked (moving it out of readonlyPaths) and adds
 * kallsyms/kmsg, which runc's default doesn't cover at all.
 */
const EXTRA_MASKED_PROC_PATHS = ["/proc/kallsyms", "/proc/kmsg", "/proc/sysrq-trigger"];

/**
 * Build the final OCI Runtime Spec (config.json) for the isolated command,
 * starting from runc's own `baseSpec` (see generateBaseOciSpec) and
 * overriding only what this sandbox needs to control:
 *
 * - root: a bind-mounted copy of the host's own `/` (rootfsBindDir, set up
 *   by run-isolated.sh before invoking runc — pivot_root can't target `/`
 *   itself), read-only except workdir/home/tmp/writablePaths, mirroring
 *   the read-only-by-default policy the previous mountinfo-walking
 *   implementation enforced by hand.
 * - linux.namespaces: same six namespace types runc's own default spec
 *   already requests (no user namespace — see docs/security.md's
 *   rationale for preserving the real UID/GID), just adding `path` to the
 *   network entry so it joins the netns run-isolated.sh already wired a
 *   veth into, instead of creating a fresh, unconnected one.
 * - process.capabilities: fully cleared (all five sets empty) plus
 *   noNewPrivileges — runc applies this natively, no setpriv needed.
 * - process.env: the step's real environment, replacing runc spec's
 *   invented PATH/TERM defaults (mirrors the previous `env -i` +
 *   re-apply-from-dump behavior: start from nothing, fill in exactly
 *   what the step's env contained).
 * - linux.seccomp: the Docker-default-profile-derived filter (see
 *   gen-seccomp-profile), resolved against this same empty capability
 *   set.
 *
 * `writablePaths` containing "/" is a sentinel meaning "disable the
 * read-only restriction entirely" (see docs/reference.md's `writable`
 * input), matching the previous implementation's `DISABLE_READONLY`
 * handling.
 */
export function buildOciConfig(
  baseSpec,
  { uid, gid, workdir, home, writablePaths = [], env, netnsPath, rootfsBindDir, resolvConfPath, seccompProfile, scriptPath },
) {
  const disableReadonly = writablePaths.includes("/");

  const mounts = [...baseSpec.mounts, { destination: "/etc/resolv.conf", type: "none", source: resolvConfPath, options: ["rbind", "ro"] }];
  if (!disableReadonly) {
    if (workdir) mounts.push({ destination: workdir, type: "none", source: workdir, options: ["rbind", "rw"] });
    if (home) mounts.push({ destination: home, type: "none", source: home, options: ["rbind", "rw"] });
    mounts.push({ destination: "/tmp", type: "none", source: "/tmp", options: ["rbind", "rw"] });
    for (const p of writablePaths) mounts.push({ destination: p, type: "none", source: p, options: ["rbind", "rw"] });
  }

  const maskedPaths = Array.from(new Set([...(baseSpec.linux.maskedPaths ?? []), ...EXTRA_MASKED_PROC_PATHS]));
  const readonlyPaths = (baseSpec.linux.readonlyPaths ?? []).filter((p) => !EXTRA_MASKED_PROC_PATHS.includes(p));

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
 * passed via `env:` — same reasoning as writeEnvDump had in the previous
 * implementation.
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
 * Unlike the previous unshare/setpriv-based implementation, uid/gid,
 * capabilities, mounts, and env are entirely described by `config.json`
 * (see buildOciConfig) — run-isolated.sh only needs enough to set up
 * networking and the rootfs bind-mount before handing off to `runc run`.
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
  ];
  if (gateway) args.push("--gateway", gateway);
  if (dns) args.push("--dns", dns);
  if (targetIp) args.push("--target-ip", targetIp);

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

/** Create/remove a scratch directory for this step's OCI bundle + run-script. */
export function withScratchDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "buildcage-sandbox-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

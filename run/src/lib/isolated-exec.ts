import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync, readFileSync, mkdirSync, chmodSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDockerCpArgs } from "./container.ts";
import { errorMessage } from "../../../core/lib/general/error-message.ts";
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

// Base directory for each run's scratch dir (OCI bundle + the host-`/`
// rootfs bind-mount). Deliberately under /var/tmp rather than os.tmpdir():
// the rootfs bind must live somewhere that is never one of the sandbox's
// writable exceptions (workdir/home/tmp/RUNNER_TEMP/writablePaths),
// otherwise the recursive writable rbind of that path would re-expose the
// whole host `/` as a second, writable copy inside the sandbox. /var/tmp
// itself is 1777 (writable by the non-root runner user) and execable, so
// this own subdirectory inherits that without needing root to create it.
// buildOciConfig fails closed if a step's `writable:` input tries to list
// this directory (or an ancestor of it) as writable — see
// assertScratchBaseNotWritable.
const SANDBOX_SCRATCH_BASE = "/var/tmp/buildcage";

interface MountEntry {
  destination: string;
  type?: string;
  source?: string;
  options?: string[];
}

interface OciSpec {
  mounts: MountEntry[];
  linux: {
    maskedPaths?: string[];
    readonlyPaths?: string[];
    namespaces: { type: string; path?: string }[];
    seccomp?: unknown;
  };
  root?: unknown;
  process: Record<string, unknown>;
}

// buildOciConfig's actual, guaranteed-populated output shape — narrower than
// the general OciSpec above, which also stands in for runc's raw, more
// loosely-known `runc spec` input.
interface BuiltOciSpec extends OciSpec {
  root: { path: string; readonly: boolean };
  process: Record<string, unknown> & {
    args: string[];
    env: string[];
    cwd: string;
    user: { uid: number; gid: number };
    capabilities: unknown;
    noNewPrivileges: boolean;
  };
  linux: OciSpec["linux"] & { maskedPaths: string[]; readonlyPaths: string[]; seccomp: unknown };
}

interface HostMount {
  mountPoint: string;
  fsType: string;
}

/**
 * Write the user-supplied `run:` input to an executable script file.
 * Routing through a file (rather than passing the command inline to a
 * shell) avoids any shell-injection surface from the input string.
 */
export function writeRunScript(runInput: string, dir: string): string {
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
export function generateBaseOciSpec(runcPath: string, bundleDir: string): OciSpec {
  execFileSync(runcPath, ["spec"], { cwd: bundleDir });
  return JSON.parse(readFileSync(join(bundleDir, "config.json"), "utf8"));
}

/**
 * Extract runc and gen-seccomp-profile from the proxy image into this run's
 * own `destDir` (its per-step scratch dir), then resolve the base OCI spec
 * and the seccomp profile from them. Run once per `run:` step; each
 * invocation is independent, and everything written here is torn down with
 * the scratch dir (see withScratchDir / cleanupScratchDir).
 *
 * Both binaries ship inside the proxy image and are pulled onto the host via
 * `docker cp`, then run natively there (not `docker exec`) since the seccomp
 * profile's content depends on the real host kernel/arch -- see
 * gen-seccomp-profile/main.go. gen-seccomp-profile is only needed transiently
 * to resolve the profile, so it's removed once read; runc stays for `runc run`.
 */
export interface ExtractRuncBootstrapOptions {
  containerName: string;
  destDir: string;
}

export interface RuncBootstrap {
  runcPath: string;
  seccompProfile: unknown;
  baseSpec: OciSpec;
}

export function extractRuncBootstrap({
  containerName,
  destDir,
}: ExtractRuncBootstrapOptions): RuncBootstrap {
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
export function parseMountinfo(mountinfoContent: string): HostMount[] {
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
export function listHostMounts(): HostMount[] {
  return parseMountinfo(readFileSync("/proc/self/mountinfo", "utf8"));
}

/**
 * Pure: given the host's real mount table, the set of paths that must stay
 * writable, and the destinations runc's own base spec already declares a
 * fresh mount for (see freshMountDestinationsFrom), return the host mount
 * points that need to be explicitly forced read-only. This exists because
 * `root.readonly` in OCI/runc only remounts the top-level rootfs mount
 * point — it does *not* recursively apply to separate mount points that
 * `mount --rbind /` duplicates into the sandbox's rootfs. A host mount
 * point is skipped only when it exactly matches one of
 * `freshMountDestinations`: runc will mount fresh content there when it
 * sets up the sandbox's own further-nested namespaces, shadowing whatever
 * the rbind copy swept in from the host at that path, so forcing that
 * (about-to-be-overridden) copy read-only would be pointless -- and some
 * pseudo-filesystems reject a read-only remount outright. Any other real
 * host mount point not covered would otherwise remain fully writable
 * despite the sandbox's documented read-only-outside-workdir/home/tmp/
 * writable guarantee. "/" itself is excluded since root.readonly already
 * covers it directly.
 */
export function computeReadonlyHostMounts(
  hostMounts: HostMount[],
  protectedPaths: Set<string>,
  freshMountDestinations: Set<string>,
): string[] {
  return hostMounts
    .filter(({ mountPoint }) => mountPoint !== "/" && !freshMountDestinations.has(mountPoint) && !protectedPaths.has(mountPoint))
    .map(({ mountPoint }) => mountPoint);
}

/**
 * Pure: the set of destination paths `baseSpec.mounts` already declares a
 * mount for. Derived directly from the actual `runc spec` output already
 * being used to build config.json (see generateBaseOciSpec), rather than a
 * hardcoded list of filesystem types -- this stays correct automatically
 * if a future runc version changes its own default mounts, and sidesteps
 * fstype ambiguity (e.g. runc's default spec declares a `cgroup`-type
 * mount at /sys/fs/cgroup that transparently resolves to the host's real
 * cgroup v1 or v2 hierarchy, so matching by destination path covers both
 * without needing to special-case a literal "cgroup2" fstype name).
 */
export interface HasMounts {
  mounts: MountEntry[];
}

export function freshMountDestinationsFrom(baseSpec: HasMounts): Set<string> {
  return new Set(baseSpec.mounts.map((m) => m.destination));
}

// runc resolves process.args[0] against the *sandbox's* PATH (the step's own
// env, which a user could override to omit /usr/bin), so resolve setpriv to an
// absolute path up front instead of relying on that lookup. The sandbox rootfs
// is a bind-mount of the host's own `/`, so a path that exists on the host
// resolves to the same binary inside. Falls back to bare "setpriv" (PATH
// lookup) only if none of the usual locations exist -- run-isolated.sh has
// already verified setpriv is on root's PATH before we get here.
const SETPRIV_CANDIDATE_PATHS = ["/usr/bin/setpriv", "/bin/setpriv", "/usr/sbin/setpriv", "/sbin/setpriv"];
function resolveSetprivPath(): string {
  return SETPRIV_CANDIDATE_PATHS.find((p) => existsSync(p)) ?? "setpriv";
}

/**
 * True if `a` and `b` are the same path, or one is an ancestor directory of
 * the other (path-component-wise, not a bare string prefix -- "/var/tmp/bu"
 * must not count as overlapping "/var/tmp/buildcage").
 */
function pathsOverlap(a: string, b: string): boolean {
  if (a === b) return true;
  const withSlash = (p: string) => (p.endsWith("/") ? p : `${p}/`);
  return a.startsWith(withSlash(b)) || b.startsWith(withSlash(a));
}

/**
 * Fail closed if any writable-exception directory is, or contains, or is
 * contained in, SANDBOX_SCRATCH_BASE. That directory holds the run's own
 * `mount --rbind /` rootfs (see rootfsBindDir in main.js); the writable
 * exceptions are recursive bind-mounts, so any overlap would recursively
 * re-expose that rootfs inside the sandbox as a second, *writable* copy of
 * the whole host `/` -- the exact escape SANDBOX_SCRATCH_BASE's placement
 * (outside the default writable set) exists to avoid. Only reachable via an
 * explicit `writable:` input naming /var/tmp/buildcage or an ancestor of it
 * (workdir/home/tmp/RUNNER_TEMP are operator/runner-controlled, not
 * attacker-controlled), so this is a misconfiguration guard, not a
 * hardening measure against a hostile isolated command.
 */
function assertScratchBaseNotWritable(writableDirs: string[]): void {
  const overlapping = writableDirs.find((p) => pathsOverlap(p, SANDBOX_SCRATCH_BASE));
  if (overlapping) {
    throw new Error(
      `writable path ${JSON.stringify(overlapping)} overlaps the sandbox's own scratch directory (${SANDBOX_SCRATCH_BASE}); ` +
        `this would re-expose the sandboxed host filesystem read-write inside the sandbox itself. Choose a writable path outside ${SANDBOX_SCRATCH_BASE}.`,
    );
  }
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
 *   only covers the top-level mount), except workdir/home/tmp/runnerTemp/
 *   writablePaths. rootfsBindDir itself lives under SANDBOX_SCRATCH_BASE,
 *   which is never one of those writable exceptions, so the recursive
 *   writable rbinds don't re-expose the host-`/` rootfs as a second, writable
 *   copy inside the sandbox (see assertScratchBaseNotWritable, which fails
 *   closed if a `writable:` input would break that invariant).
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
export interface BuildOciConfigOptions {
  uid: number;
  gid: number;
  workdir?: string;
  home?: string;
  runnerTemp?: string;
  writablePaths?: string[];
  env: NodeJS.ProcessEnv;
  netnsPath: string;
  rootfsBindDir: string;
  resolvConfPath: string;
  seccompProfile: unknown;
  scriptPath: string;
  hostMounts?: HostMount[];
}

export function buildOciConfig(
  baseSpec: OciSpec,
  {
    uid,
    gid,
    workdir,
    home,
    runnerTemp,
    writablePaths = [],
    env,
    netnsPath,
    rootfsBindDir,
    resolvConfPath,
    seccompProfile,
    scriptPath,
    hostMounts = [],
  }: BuildOciConfigOptions,
): BuiltOciSpec {
  const disableReadonly = writablePaths.includes("/");

  const mounts = [...baseSpec.mounts, { destination: "/etc/resolv.conf", type: "none", source: resolvConfPath, options: ["rbind", "ro"] }];
  // Paths kept writable on top of the read-only root. RUNNER_TEMP is included
  // because many actions/tools write there and it isn't always under $HOME
  // (self-hosted runners can place it elsewhere), so the $HOME exception
  // wouldn't otherwise cover it. Deduped so an overlapping entry (RUNNER_TEMP
  // nested under $HOME, or a writablePaths duplicate) isn't bind-mounted twice.
  const writableDirs = [
    ...new Set([workdir, home, "/tmp", runnerTemp, ...writablePaths].filter((p): p is string => Boolean(p))),
  ];
  const protectedPaths = new Set(writableDirs);
  if (!disableReadonly) {
    // `writable: /` (disableReadonly) is an intentional, documented full
    // opt-out of the read-only restriction, so it's exempt from this guard.
    assertScratchBaseNotWritable(writableDirs);
    for (const p of writableDirs) mounts.push({ destination: p, type: "none", source: p, options: ["rbind", "rw"] });
  }

  const maskedPaths = [...(baseSpec.linux.maskedPaths ?? []), ...EXTRA_MASKED_PROC_PATHS];
  const baseReadonlyPaths = (baseSpec.linux.readonlyPaths ?? []).filter((p) => !EXTRA_MASKED_PROC_PATHS.includes(p));
  const readonlyPaths = disableReadonly
    ? baseReadonlyPaths
    : Array.from(
        new Set([...baseReadonlyPaths, ...computeReadonlyHostMounts(hostMounts, protectedPaths, freshMountDestinationsFrom(baseSpec))]),
      );

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
      args: [resolveSetprivPath(), "--pdeathsig=KILL", "--", scriptPath],
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
export function writeOciConfig(config: unknown, bundleDir: string): string {
  const configPath = join(bundleDir, "config.json");
  writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
  return configPath;
}

/** Write the resolv.conf bind-mount source referenced by buildOciConfig. */
export function writeResolvConf(dns: string, dir: string): string {
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
export interface RunIsolatedOptions {
  runcPath: string;
  proxyPid: number;
  bundleDir: string;
  containerId: string;
  netnsName: string;
  rootfsBindDir: string;
  gateway: string;
  dns: string;
  targetIp: string;
}

export function runIsolated({
  runcPath,
  proxyPid,
  bundleDir,
  containerId,
  netnsName,
  rootfsBindDir,
  gateway,
  dns,
  targetIp,
}: RunIsolatedOptions): number {
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
    const status = (e as { status?: number | null }).status;
    return typeof status === "number" ? status : 1;
  }
}

/**
 * Pure: mount points from raw /proc/self/mountinfo content that are
 * nested under `dir` (including `dir` itself), deepest-path-first so a
 * caller can safely unmount children before their parents.
 */
export function parseMountsUnder(mountinfoContent: string, dir: string): string[] {
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
function unmountAllUnder(dir: string): void {
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
      console.log(`::warning::Failed to unmount ${mountPoint} before cleanup: ${errorMessage(e)}`);
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
function removeScratchDir(dir: string): void {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EBUSY" || attempt === maxAttempts) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
}

/**
 * Force-detach anything still mounted under `dir` (the rootfs bind-mount
 * safety net — see unmountAllUnder) and then recursively remove it. Exported
 * so post.js can reclaim a scratch dir orphaned by a hard kill that bypassed
 * withScratchDir's own finally. No-ops safely when `dir` doesn't exist.
 */
export function cleanupScratchDir(dir: string): void {
  unmountAllUnder(dir);
  removeScratchDir(dir);
}

/**
 * Absolute path of the scratch dir for a given proxy container, derived
 * deterministically from `containerName` (the `buildcage-proxy-` prefix
 * swapped for `sandbox-`, under SANDBOX_SCRATCH_BASE). Lets the post step
 * reconstruct and reclaim the exact same directory from `STATE_container_name`
 * alone.
 */
export function scratchDirFor(containerName: string): string {
  return join(SANDBOX_SCRATCH_BASE, containerName.replace(/^buildcage-proxy-/, "sandbox-"));
}

/**
 * Create/remove a scratch directory for this step's OCI bundle + run-script.
 * With `containerName` the dir is named deterministically (scratchDirFor) so
 * post.js can reclaim it after a hard kill; without it a random mkdtemp name
 * is used (unit tests). Cleaned up on every exit path that unwinds — a
 * SIGKILL bypasses this finally, which is exactly what post.js covers.
 */
export function withScratchDir<T>(fn: (dir: string) => T, containerName?: string): T {
  let dir: string;
  mkdirSync(SANDBOX_SCRATCH_BASE, { recursive: true, mode: 0o755 });
  if (containerName) {
    dir = scratchDirFor(containerName);
    cleanupScratchDir(dir); // clear any stale remnant at this deterministic path (unmount-safe)
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } else {
    dir = mkdtempSync(join(SANDBOX_SCRATCH_BASE, "sandbox-"));
  }
  try {
    return fn(dir);
  } finally {
    cleanupScratchDir(dir);
  }
}

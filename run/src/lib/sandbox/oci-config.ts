import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { HasMounts, OciSpec, BuiltOciSpec, HostMount } from "./types.ts";
import { SANDBOX_SCRATCH_BASE } from "./scratch-dir.ts";
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
import EXTRA_MASKED_PROC_PATHS from "../../../scripts/extra-masked-proc-paths.json" with { type: "json" };

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
    .filter(
      ({ mountPoint }) =>
        mountPoint !== "/" &&
        !freshMountDestinations.has(mountPoint) &&
        !protectedPaths.has(mountPoint),
    )
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
const SETPRIV_CANDIDATE_PATHS = [
  "/usr/bin/setpriv",
  "/bin/setpriv",
  "/usr/sbin/setpriv",
  "/sbin/setpriv",
];
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
 * `mount --rbind /` rootfs (see rootfsBindDir in main.ts); the writable
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
/** Linux-level identity the sandboxed process runs as. */
export interface SandboxIdentity {
  uid: number;
  gid: number;
}

/** The directories kept writable on top of the read-only root; see the
 *  writableDirs computation below for how these combine. */
export interface WritablePolicy {
  workdir?: string;
  home?: string;
  runnerTemp?: string;
  writablePaths?: string[];
}

/** How this OCI config wires into run-isolated.sh's own setup (the netns it
 *  already created, the rootfs bind-mount it will do, etc). */
export interface SandboxRuntimeWiring {
  netnsPath: string;
  rootfsBindDir: string;
  resolvConfPath: string;
  seccompProfile: unknown;
  scriptPath: string;
  hostMounts?: HostMount[];
}

export interface BuildOciConfigOptions {
  identity: SandboxIdentity;
  writable: WritablePolicy;
  runtime: SandboxRuntimeWiring;
  env: NodeJS.ProcessEnv;
}

export function buildOciConfig(
  baseSpec: OciSpec,
  { identity, writable, runtime, env }: BuildOciConfigOptions,
): BuiltOciSpec {
  const { uid, gid } = identity;
  const { workdir, home, runnerTemp, writablePaths = [] } = writable;
  const {
    netnsPath,
    rootfsBindDir,
    resolvConfPath,
    seccompProfile,
    scriptPath,
    hostMounts = [],
  } = runtime;
  const disableReadonly = writablePaths.includes("/");

  const mounts = [
    ...baseSpec.mounts,
    {
      destination: "/etc/resolv.conf",
      type: "none",
      source: resolvConfPath,
      options: ["rbind", "ro"],
    },
  ];
  // Paths kept writable on top of the read-only root. RUNNER_TEMP is included
  // because many actions/tools write there and it isn't always under $HOME
  // (self-hosted runners can place it elsewhere), so the $HOME exception
  // wouldn't otherwise cover it. Deduped so an overlapping entry (RUNNER_TEMP
  // nested under $HOME, or a writablePaths duplicate) isn't bind-mounted twice.
  const writableDirs = [
    ...new Set(
      [workdir, home, "/tmp", runnerTemp, ...writablePaths].filter((p): p is string => Boolean(p)),
    ),
  ];
  const protectedPaths = new Set(writableDirs);
  if (!disableReadonly) {
    // `writable: /` (disableReadonly) is an intentional, documented full
    // opt-out of the read-only restriction, so it's exempt from this guard.
    assertScratchBaseNotWritable(writableDirs);
    for (const p of writableDirs)
      mounts.push({ destination: p, type: "none", source: p, options: ["rbind", "rw"] });
  }

  const maskedPaths = [...(baseSpec.linux.maskedPaths ?? []), ...EXTRA_MASKED_PROC_PATHS];
  const baseReadonlyPaths = (baseSpec.linux.readonlyPaths ?? []).filter(
    (p) => !EXTRA_MASKED_PROC_PATHS.includes(p),
  );
  const readonlyPaths = disableReadonly
    ? baseReadonlyPaths
    : Array.from(
        new Set([
          ...baseReadonlyPaths,
          ...computeReadonlyHostMounts(
            hostMounts,
            protectedPaths,
            freshMountDestinationsFrom(baseSpec),
          ),
        ]),
      );

  const namespaces = baseSpec.linux.namespaces.map((ns) =>
    ns.type === "network" ? { ...ns, path: netnsPath } : ns,
  );

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

import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";

import {
  writeRunScript,
  writeResolvConf,
  computeReadonlyHostMounts,
  freshMountDestinationsFrom,
  buildOciConfig,
  writeOciConfig,
} from "./oci-config.ts";
import { parseMountinfo } from "./mountinfo.ts";
import { withScratchDir } from "./scratch-dir.ts";

describe("writeRunScript", () => {
  it("wraps plain commands in a #!/bin/sh + set -e preamble", () => {
    withScratchDir((dir) => {
      const path = writeRunScript("echo hello", dir);
      const content = readFileSync(path, "utf8");
      expect(content).toBe("#!/bin/sh\nset -e\necho hello\n");
    });
  });

  it("leaves an input that already starts with a shebang untouched", () => {
    withScratchDir((dir) => {
      const script = "#!/usr/bin/env bash\necho custom-shebang\n";
      const path = writeRunScript(script, dir);
      expect(readFileSync(path, "utf8")).toBe(script);
    });
  });

  it("writes the script as executable", () => {
    withScratchDir((dir) => {
      const path = writeRunScript("echo hi", dir);
      const mode = statSync(path).mode & 0o777;
      expect(mode).toBe(0o700);
    });
  });
});

describe("writeResolvConf", () => {
  it("writes a single nameserver line", () => {
    withScratchDir((dir) => {
      const path = writeResolvConf("172.20.0.1", dir);
      expect(readFileSync(path, "utf8")).toBe("nameserver 172.20.0.1\n");
    });
  });
});

// Realistic /proc/self/mountinfo lines (see parseMountinfo's doc comment
// for the field layout). Each has one optional field ("shared:N") before
// the "-" separator, matching what a systemd-managed host typically shows.
const SAMPLE_MOUNTINFO = [
  "1 0 0:1 / / rw,relatime shared:1 - ext4 /dev/root rw",
  "2 1 0:2 / /proc rw,relatime shared:2 - proc proc rw",
  "3 1 0:3 / /run rw,nosuid,relatime shared:3 - tmpfs tmpfs rw,size=100k",
  "4 3 0:4 / /run/user/1000 rw,nosuid,relatime shared:4 - tmpfs tmpfs rw",
  "5 1 0:5 / /mnt rw,relatime shared:5 - ext4 /dev/sdb1 rw",
].join("\n");

describe("computeReadonlyHostMounts", () => {
  const hostMounts = parseMountinfo(SAMPLE_MOUNTINFO);
  const freshMountDestinations = new Set(["/proc"]);

  it("excludes '/' itself (already covered by root.readonly)", () => {
    const result = computeReadonlyHostMounts(hostMounts, new Set(), freshMountDestinations);
    expect(!result.includes("/")).toBeTruthy();
  });

  it("excludes paths runc's own base spec already mounts fresh", () => {
    const result = computeReadonlyHostMounts(hostMounts, new Set(), freshMountDestinations);
    expect(!result.includes("/proc")).toBeTruthy();
  });

  it("excludes explicitly protected (writable) paths", () => {
    const result = computeReadonlyHostMounts(hostMounts, new Set(["/run"]), freshMountDestinations);
    expect(!result.includes("/run")).toBeTruthy();
    expect(
      result.includes("/run/user/1000"),
      "a nested mount under a protected path is still its own separate mount point",
    ).toBeTruthy();
  });

  it("includes real, non-pseudo, non-protected host mounts (e.g. a separate disk at /mnt)", () => {
    const result = computeReadonlyHostMounts(hostMounts, new Set(), freshMountDestinations);
    expect(result.includes("/mnt")).toBeTruthy();
    expect(result.includes("/run")).toBeTruthy();
    expect(result.includes("/run/user/1000")).toBeTruthy();
  });

  it("includes a pseudo-filesystem-like mount whose path isn't one of runc's own fresh destinations", () => {
    // e.g. securityfs at /sys/kernel/security: it looks like the same
    // "kernel pseudo-fs" class as /proc, but runc's default spec never
    // declares a mount for it, so the host-swept copy must be forced
    // read-only just like any other real mount point.
    const withSecurityfs = [
      ...hostMounts,
      { mountPoint: "/sys/kernel/security", fsType: "securityfs" },
    ];
    const result = computeReadonlyHostMounts(withSecurityfs, new Set(), freshMountDestinations);
    expect(result.includes("/sys/kernel/security")).toBeTruthy();
  });
});

describe("freshMountDestinationsFrom", () => {
  it("collects every mounts[].destination from the base spec", () => {
    const baseSpec = {
      mounts: [{ destination: "/proc" }, { destination: "/sys" }, { destination: "/dev/pts" }],
    };
    expect(freshMountDestinationsFrom(baseSpec)).toStrictEqual(
      new Set(["/proc", "/sys", "/dev/pts"]),
    );
  });
});

// A minimal stand-in for what `runc spec` actually produces (see
// runc-bootstrap.ts's generateBaseOciSpec) — only the fields buildOciConfig
// reads/overrides are included.
function fakeBaseSpec() {
  return {
    ociVersion: "1.0.2",
    root: { path: "rootfs", readonly: true },
    mounts: [
      { destination: "/proc", type: "proc", source: "proc" },
      { destination: "/sys", type: "none", source: "/sys", options: ["rbind", "ro"] },
    ],
    process: {
      terminal: true,
      user: { uid: 0, gid: 0 },
      args: ["sh"],
      env: ["PATH=/usr/local/sbin:/usr/local/bin", "TERM=xterm"],
      cwd: "/",
      capabilities: {
        bounding: ["CAP_AUDIT_WRITE", "CAP_KILL", "CAP_NET_BIND_SERVICE"],
        effective: ["CAP_AUDIT_WRITE", "CAP_KILL", "CAP_NET_BIND_SERVICE"],
        permitted: ["CAP_AUDIT_WRITE", "CAP_KILL", "CAP_NET_BIND_SERVICE"],
        inheritable: [],
        ambient: [],
      },
    },
    linux: {
      namespaces: [
        { type: "pid" },
        { type: "network" },
        { type: "ipc" },
        { type: "uts" },
        { type: "mount" },
        { type: "cgroup" },
      ],
      maskedPaths: ["/proc/acpi", "/proc/kcore", "/proc/keys", "/proc/timer_list"],
      readonlyPaths: ["/proc/bus", "/proc/sysrq-trigger"],
    },
  };
}

describe("buildOciConfig", () => {
  const baseArgs = {
    identity: { uid: 1000, gid: 1000 },
    writable: {
      workdir: "/home/runner/work/repo/repo",
      home: "/home/runner",
      writablePaths: [] as string[],
    },
    runtime: {
      netnsPath: "/var/run/netns/buildcage-sandbox-abcd1234",
      rootfsBindDir: "/tmp/buildcage-sandbox-xyz/rootfs",
      resolvConfPath: "/tmp/buildcage-sandbox-xyz/resolv.conf",
      seccompProfile: { defaultAction: "SCMP_ACT_ERRNO" },
      scriptPath: "/tmp/buildcage-sandbox-xyz/run-script.sh",
    },
    env: { FOO: "bar", UNSET: undefined },
  };

  it("clears all five capability sets and sets noNewPrivileges", () => {
    const config = buildOciConfig(fakeBaseSpec(), baseArgs);
    expect(config.process.capabilities).toStrictEqual({
      bounding: [],
      effective: [],
      permitted: [],
      inheritable: [],
      ambient: [],
    });
    expect(config.process.noNewPrivileges).toBe(true);
  });

  it("sets uid/gid and cwd from the given options", () => {
    const config = buildOciConfig(fakeBaseSpec(), baseArgs);
    expect(config.process.user).toStrictEqual({ uid: 1000, gid: 1000 });
    expect(config.process.cwd).toBe(baseArgs.writable.workdir);
  });

  it("wraps the script in `setpriv --pdeathsig=KILL` (die-with-parent, see run-isolated.sh)", () => {
    const config = buildOciConfig(fakeBaseSpec(), baseArgs);
    // args[0] is setpriv resolved to an absolute path where it exists (e.g.
    // /usr/bin/setpriv on Linux), falling back to bare "setpriv" otherwise.
    expect(config.process.args[0]).toMatch(/(^|\/)setpriv$/);
    expect(config.process.args.slice(1)).toStrictEqual([
      "--pdeathsig=KILL",
      "--",
      baseArgs.runtime.scriptPath,
    ]);
  });

  it("replaces process.env with the given env, dropping undefined values", () => {
    const config = buildOciConfig(fakeBaseSpec(), baseArgs);
    expect(config.process.env).toStrictEqual(["FOO=bar"]);
  });

  it("adds `path` to the network namespace entry, leaving other namespace types untouched", () => {
    const config = buildOciConfig(fakeBaseSpec(), baseArgs);
    const netNs = config.linux.namespaces.find((ns) => ns.type === "network");
    expect(netNs!.path).toBe(baseArgs.runtime.netnsPath);
    expect(config.linux.namespaces.length).toBe(6);
  });

  it("extends maskedPaths with kallsyms/kmsg/sysrq-trigger and moves sysrq-trigger out of readonlyPaths", () => {
    const config = buildOciConfig(fakeBaseSpec(), baseArgs);
    for (const p of [
      "/proc/kallsyms",
      "/proc/kmsg",
      "/proc/sysrq-trigger",
      "/proc/kcore",
      "/proc/keys",
      "/proc/timer_list",
    ]) {
      expect(
        config.linux.maskedPaths.includes(p),
        `expected maskedPaths to include ${p}`,
      ).toBeTruthy();
    }
    expect(!config.linux.readonlyPaths.includes("/proc/sysrq-trigger")).toBeTruthy();
    expect(config.linux.readonlyPaths.includes("/proc/bus")).toBeTruthy();
  });

  it("embeds the seccomp profile as-is", () => {
    const config = buildOciConfig(fakeBaseSpec(), baseArgs);
    expect(config.linux.seccomp).toStrictEqual(baseArgs.runtime.seccompProfile);
  });

  it("makes root read-only and binds workdir/home/tmp/writablePaths as writable exceptions", () => {
    const config = buildOciConfig(fakeBaseSpec(), {
      ...baseArgs,
      writable: { ...baseArgs.writable, writablePaths: ["/opt/cache"] },
    });
    expect(config.root.readonly).toBe(true);
    expect(config.root.path).toBe(baseArgs.runtime.rootfsBindDir);
    const rw = config.mounts.filter((m) => m.options?.includes("rw")).map((m) => m.destination);
    expect(rw.sort()).toStrictEqual(
      ["/opt/cache", "/tmp", baseArgs.writable.home, baseArgs.writable.workdir].sort(),
    );
  });

  it("does not mount anything over rootfsBindDir (it lives under /var/tmp/buildcage, so nothing re-exposes it)", () => {
    const config = buildOciConfig(fakeBaseSpec(), {
      ...baseArgs,
      writable: { ...baseArgs.writable, writablePaths: ["/opt/cache"] },
    });
    expect(
      !config.mounts.some((m) => m.destination === baseArgs.runtime.rootfsBindDir),
    ).toBeTruthy();
  });

  it("fails closed when writable: lists the scratch base itself", () => {
    expect(() =>
      buildOciConfig(fakeBaseSpec(), {
        ...baseArgs,
        writable: { ...baseArgs.writable, writablePaths: ["/var/tmp/buildcage"] },
      }),
    ).toThrow(/overlaps the sandbox's own scratch directory/);
  });

  it("fails closed when writable: lists an ancestor of the scratch base", () => {
    expect(() =>
      buildOciConfig(fakeBaseSpec(), {
        ...baseArgs,
        writable: { ...baseArgs.writable, writablePaths: ["/var/tmp"] },
      }),
    ).toThrow(/overlaps/);
  });

  it("fails closed when writable: lists a descendant of the scratch base", () => {
    expect(() =>
      buildOciConfig(fakeBaseSpec(), {
        ...baseArgs,
        writable: {
          ...baseArgs.writable,
          writablePaths: ["/var/tmp/buildcage/some-other-run"],
        },
      }),
    ).toThrow(/overlaps/);
  });

  it("fails closed when $HOME or RUNNER_TEMP itself overlaps the scratch base", () => {
    expect(() =>
      buildOciConfig(fakeBaseSpec(), {
        ...baseArgs,
        writable: { ...baseArgs.writable, home: "/var/tmp/buildcage", writablePaths: [] },
      }),
    ).toThrow(/overlaps/);
  });

  it("does not fail closed for an unrelated sibling under /var/tmp", () => {
    expect(() =>
      buildOciConfig(fakeBaseSpec(), {
        ...baseArgs,
        writable: { ...baseArgs.writable, writablePaths: ["/var/tmp/some-other-tool"] },
      }),
    ).not.toThrow();
  });

  it("`writable: /` is exempt from the scratch-base guard (documented full opt-out)", () => {
    expect(() =>
      buildOciConfig(fakeBaseSpec(), {
        ...baseArgs,
        writable: { ...baseArgs.writable, writablePaths: ["/"] },
      }),
    ).not.toThrow();
  });

  it("keeps RUNNER_TEMP writable (rw bind) and out of readonlyPaths", () => {
    const runnerTemp = "/opt/actions-runner/_work/_temp"; // self-hosted: outside $HOME
    const hostMounts = [
      { mountPoint: "/", fsType: "ext4" },
      { mountPoint: runnerTemp, fsType: "ext4" },
    ];
    const config = buildOciConfig(fakeBaseSpec(), {
      ...baseArgs,
      writable: { ...baseArgs.writable, writablePaths: [], runnerTemp },
      runtime: { ...baseArgs.runtime, hostMounts },
    });
    const rw = config.mounts.filter((m) => m.options?.includes("rw")).map((m) => m.destination);
    expect(rw.includes(runnerTemp), "RUNNER_TEMP must be bind-mounted writable").toBeTruthy();
    expect(
      !config.linux.readonlyPaths.includes(runnerTemp),
      "RUNNER_TEMP must not be forced read-only",
    ).toBeTruthy();
  });

  it("does not double-mount RUNNER_TEMP when it duplicates another writable path", () => {
    const config = buildOciConfig(fakeBaseSpec(), {
      ...baseArgs,
      writable: { ...baseArgs.writable, writablePaths: [], runnerTemp: "/tmp" },
    });
    const tmpMounts = config.mounts.filter(
      (m) => m.destination === "/tmp" && m.options?.includes("rw"),
    );
    expect(tmpMounts.length).toBe(1);
  });

  it("adds a read-only resolv.conf bind mount", () => {
    const config = buildOciConfig(fakeBaseSpec(), baseArgs);
    const resolv = config.mounts.find((m) => m.destination === "/etc/resolv.conf");
    expect(resolv).toStrictEqual({
      destination: "/etc/resolv.conf",
      type: "none",
      source: baseArgs.runtime.resolvConfPath,
      options: ["rbind", "ro"],
    });
  });

  it("`writable: /` disables the read-only root and skips the individual writable-path mounts", () => {
    const config = buildOciConfig(fakeBaseSpec(), {
      ...baseArgs,
      writable: { ...baseArgs.writable, writablePaths: ["/"] },
    });
    expect(config.root.readonly).toBe(false);
    const rw = config.mounts.filter((m) => m.options?.includes("rw"));
    expect(rw.length).toBe(0);
  });

  it("forces real host mount points not already writable into readonlyPaths (root.readonly alone doesn't cover them)", () => {
    const hostMounts = [
      { mountPoint: "/", fsType: "ext4" },
      { mountPoint: "/proc", fsType: "proc" },
      { mountPoint: "/mnt", fsType: "ext4" },
      { mountPoint: baseArgs.writable.workdir, fsType: "ext4" },
    ];
    const config = buildOciConfig(fakeBaseSpec(), {
      ...baseArgs,
      writable: { ...baseArgs.writable, writablePaths: [] },
      runtime: { ...baseArgs.runtime, hostMounts },
    });
    expect(
      config.linux.readonlyPaths.includes("/mnt"),
      "a real, separate host mount not covered by root.readonly must be listed explicitly",
    ).toBeTruthy();
    expect(
      !config.linux.readonlyPaths.includes("/"),
      "'/' itself is already covered by root.readonly",
    ).toBeTruthy();
    expect(
      !config.linux.readonlyPaths.includes("/proc"),
      "pseudo-filesystems get their own fresh mount, not a readonly remount of the host copy",
    ).toBeTruthy();
    expect(
      !config.linux.readonlyPaths.includes(baseArgs.writable.workdir),
      "workdir must stay writable, not be added to readonlyPaths",
    ).toBeTruthy();
  });

  it("`writable: /` skips the host-mount readonly pass entirely", () => {
    const hostMounts = [{ mountPoint: "/mnt", fsType: "ext4" }];
    const config = buildOciConfig(fakeBaseSpec(), {
      ...baseArgs,
      writable: { ...baseArgs.writable, writablePaths: ["/"] },
      runtime: { ...baseArgs.runtime, hostMounts },
    });
    expect(!config.linux.readonlyPaths.includes("/mnt")).toBeTruthy();
  });

  it("forces a kernel pseudo-fs into readonlyPaths when runc's own base spec doesn't mount it fresh", () => {
    // Regression guard: a fixed allowlist of "pseudo-fs" filesystem types
    // previously tolerated anything that merely looked like proc/sysfs/etc,
    // even when runc's own base spec (fakeBaseSpec here only declares
    // /proc and /sys) never actually gives it a fresh, isolated mount --
    // e.g. securityfs at /sys/kernel/security, which is commonly mounted
    // read-write on AppArmor-enabled hosts.
    const hostMounts = [{ mountPoint: "/sys/kernel/security", fsType: "securityfs" }];
    const config = buildOciConfig(fakeBaseSpec(), {
      ...baseArgs,
      writable: { ...baseArgs.writable, writablePaths: [] },
      runtime: { ...baseArgs.runtime, hostMounts },
    });
    expect(config.linux.readonlyPaths.includes("/sys/kernel/security")).toBeTruthy();
  });
});

describe("writeOciConfig", () => {
  it("writes valid JSON matching the given config", () => {
    withScratchDir((dir) => {
      const config = { ociVersion: "1.0.2", process: { args: ["/bin/true"] } };
      const path = writeOciConfig(config, dir);
      expect(JSON.parse(readFileSync(path, "utf8"))).toStrictEqual(config);
    });
  });

  it("writes config.json 0600 (process.env can hold secrets from the step's env:)", () => {
    withScratchDir((dir) => {
      const path = writeOciConfig({ process: { env: ["SECRET=s3cr3t"] } }, dir);
      const mode = statSync(path).mode & 0o777;
      expect(mode).toBe(0o600);
    });
  });
});

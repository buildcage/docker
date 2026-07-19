import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  writeRunScript,
  writeResolvConf,
  buildOciConfig,
  writeOciConfig,
  withScratchDir,
  parseMountinfo,
  computeReadonlyHostMounts,
  parseMountsUnder,
} from "./isolated-exec.js";

describe("writeRunScript", () => {
  it("wraps plain commands in a #!/bin/sh + set -e preamble", () => {
    withScratchDir((dir) => {
      const path = writeRunScript("echo hello", dir);
      const content = readFileSync(path, "utf8");
      assert.equal(content, "#!/bin/sh\nset -e\necho hello\n");
    });
  });

  it("leaves an input that already starts with a shebang untouched", () => {
    withScratchDir((dir) => {
      const script = "#!/usr/bin/env bash\necho custom-shebang\n";
      const path = writeRunScript(script, dir);
      assert.equal(readFileSync(path, "utf8"), script);
    });
  });

  it("writes the script as executable", () => {
    withScratchDir((dir) => {
      const path = writeRunScript("echo hi", dir);
      const mode = statSync(path).mode & 0o777;
      assert.equal(mode, 0o700);
    });
  });
});

describe("writeResolvConf", () => {
  it("writes a single nameserver line", () => {
    withScratchDir((dir) => {
      const path = writeResolvConf("172.20.0.1", dir);
      assert.equal(readFileSync(path, "utf8"), "nameserver 172.20.0.1\n");
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

describe("parseMountinfo", () => {
  it("extracts the mount point and filesystem type of every line", () => {
    assert.deepEqual(parseMountinfo(SAMPLE_MOUNTINFO), [
      { mountPoint: "/", fsType: "ext4" },
      { mountPoint: "/proc", fsType: "proc" },
      { mountPoint: "/run", fsType: "tmpfs" },
      { mountPoint: "/run/user/1000", fsType: "tmpfs" },
      { mountPoint: "/mnt", fsType: "ext4" },
    ]);
  });

  it("ignores trailing/blank lines", () => {
    assert.deepEqual(parseMountinfo(`${SAMPLE_MOUNTINFO}\n\n`).length, 5);
  });
});

describe("computeReadonlyHostMounts", () => {
  const hostMounts = parseMountinfo(SAMPLE_MOUNTINFO);

  it("excludes '/' itself (already covered by root.readonly)", () => {
    const result = computeReadonlyHostMounts(hostMounts, new Set());
    assert.ok(!result.includes("/"));
  });

  it("excludes tolerated pseudo-filesystems (proc gets its own fresh mount from runc)", () => {
    const result = computeReadonlyHostMounts(hostMounts, new Set());
    assert.ok(!result.includes("/proc"));
  });

  it("excludes explicitly protected (writable) paths", () => {
    const result = computeReadonlyHostMounts(hostMounts, new Set(["/run"]));
    assert.ok(!result.includes("/run"));
    assert.ok(result.includes("/run/user/1000"), "a nested mount under a protected path is still its own separate mount point");
  });

  it("includes real, non-pseudo, non-protected host mounts (e.g. a separate disk at /mnt)", () => {
    const result = computeReadonlyHostMounts(hostMounts, new Set());
    assert.ok(result.includes("/mnt"));
    assert.ok(result.includes("/run"));
    assert.ok(result.includes("/run/user/1000"));
  });
});

describe("parseMountsUnder", () => {
  const mountinfo = [
    "1 0 0:1 / / rw,relatime shared:1 - ext4 /dev/root rw",
    "2 1 0:2 / /tmp/buildcage-sandbox-abc rw,relatime shared:2 - tmpfs tmpfs rw",
    "3 2 0:3 / /tmp/buildcage-sandbox-abc/rootfs rw,relatime shared:3 - ext4 /dev/root rw",
    "4 1 0:4 / /tmp/other-dir rw,relatime shared:4 - tmpfs tmpfs rw",
  ].join("\n");

  it("finds only mount points nested under the given directory", () => {
    const result = parseMountsUnder(mountinfo, "/tmp/buildcage-sandbox-abc");
    assert.deepEqual(result.sort(), ["/tmp/buildcage-sandbox-abc", "/tmp/buildcage-sandbox-abc/rootfs"].sort());
  });

  it("orders deepest paths first, so children are unmounted before their parents", () => {
    const result = parseMountsUnder(mountinfo, "/tmp/buildcage-sandbox-abc");
    assert.deepEqual(result, ["/tmp/buildcage-sandbox-abc/rootfs", "/tmp/buildcage-sandbox-abc"]);
  });

  it("does not match a sibling directory with a similar prefix", () => {
    const result = parseMountsUnder(mountinfo, "/tmp/buildcage-sandbox-ab");
    assert.deepEqual(result, []);
  });
});

// A minimal stand-in for what `runc spec` actually produces (see
// isolated-exec.js's generateBaseOciSpec) — only the fields buildOciConfig
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
      namespaces: [{ type: "pid" }, { type: "network" }, { type: "ipc" }, { type: "uts" }, { type: "mount" }, { type: "cgroup" }],
      maskedPaths: ["/proc/acpi", "/proc/kcore", "/proc/keys", "/proc/timer_list"],
      readonlyPaths: ["/proc/bus", "/proc/sysrq-trigger"],
    },
  };
}

describe("buildOciConfig", () => {
  const baseArgs = {
    uid: 1000,
    gid: 1000,
    workdir: "/home/runner/work/repo/repo",
    home: "/home/runner",
    env: { FOO: "bar", UNSET: undefined },
    netnsPath: "/var/run/netns/buildcage-sandbox-abcd1234",
    rootfsBindDir: "/tmp/buildcage-sandbox-xyz/rootfs",
    resolvConfPath: "/tmp/buildcage-sandbox-xyz/resolv.conf",
    seccompProfile: { defaultAction: "SCMP_ACT_ERRNO" },
    scriptPath: "/tmp/buildcage-sandbox-xyz/run-script.sh",
  };

  it("clears all five capability sets and sets noNewPrivileges", () => {
    const config = buildOciConfig(fakeBaseSpec(), { ...baseArgs, writablePaths: [] });
    assert.deepEqual(config.process.capabilities, { bounding: [], effective: [], permitted: [], inheritable: [], ambient: [] });
    assert.equal(config.process.noNewPrivileges, true);
  });

  it("sets uid/gid and cwd from the given options", () => {
    const config = buildOciConfig(fakeBaseSpec(), { ...baseArgs, writablePaths: [] });
    assert.deepEqual(config.process.user, { uid: 1000, gid: 1000 });
    assert.equal(config.process.cwd, baseArgs.workdir);
  });

  it("wraps the script in `setpriv --pdeathsig=KILL` (die-with-parent, see run-isolated.sh)", () => {
    const config = buildOciConfig(fakeBaseSpec(), { ...baseArgs, writablePaths: [] });
    assert.deepEqual(config.process.args, ["setpriv", "--pdeathsig=KILL", "--", baseArgs.scriptPath]);
  });

  it("replaces process.env with the given env, dropping undefined values", () => {
    const config = buildOciConfig(fakeBaseSpec(), { ...baseArgs, writablePaths: [] });
    assert.deepEqual(config.process.env, ["FOO=bar"]);
  });

  it("adds `path` to the network namespace entry, leaving other namespace types untouched", () => {
    const config = buildOciConfig(fakeBaseSpec(), { ...baseArgs, writablePaths: [] });
    const netNs = config.linux.namespaces.find((ns) => ns.type === "network");
    assert.equal(netNs.path, baseArgs.netnsPath);
    assert.equal(config.linux.namespaces.length, 6);
  });

  it("extends maskedPaths with kallsyms/kmsg/sysrq-trigger and moves sysrq-trigger out of readonlyPaths", () => {
    const config = buildOciConfig(fakeBaseSpec(), { ...baseArgs, writablePaths: [] });
    for (const p of ["/proc/kallsyms", "/proc/kmsg", "/proc/sysrq-trigger", "/proc/kcore", "/proc/keys", "/proc/timer_list"]) {
      assert.ok(config.linux.maskedPaths.includes(p), `expected maskedPaths to include ${p}`);
    }
    assert.ok(!config.linux.readonlyPaths.includes("/proc/sysrq-trigger"));
    assert.ok(config.linux.readonlyPaths.includes("/proc/bus"));
  });

  it("embeds the seccomp profile as-is", () => {
    const config = buildOciConfig(fakeBaseSpec(), { ...baseArgs, writablePaths: [] });
    assert.deepEqual(config.linux.seccomp, baseArgs.seccompProfile);
  });

  it("makes root read-only and binds workdir/home/tmp/writablePaths as writable exceptions", () => {
    const config = buildOciConfig(fakeBaseSpec(), { ...baseArgs, writablePaths: ["/opt/cache"] });
    assert.equal(config.root.readonly, true);
    assert.equal(config.root.path, baseArgs.rootfsBindDir);
    const rw = config.mounts.filter((m) => m.options?.includes("rw")).map((m) => m.destination);
    assert.deepEqual(rw.sort(), ["/opt/cache", "/tmp", baseArgs.home, baseArgs.workdir].sort());
  });

  it("adds a read-only resolv.conf bind mount", () => {
    const config = buildOciConfig(fakeBaseSpec(), { ...baseArgs, writablePaths: [] });
    const resolv = config.mounts.find((m) => m.destination === "/etc/resolv.conf");
    assert.deepEqual(resolv, { destination: "/etc/resolv.conf", type: "none", source: baseArgs.resolvConfPath, options: ["rbind", "ro"] });
  });

  it("`writable: /` disables the read-only root and skips the individual writable-path mounts", () => {
    const config = buildOciConfig(fakeBaseSpec(), { ...baseArgs, writablePaths: ["/"] });
    assert.equal(config.root.readonly, false);
    const rw = config.mounts.filter((m) => m.options?.includes("rw"));
    assert.equal(rw.length, 0);
  });

  it("forces real host mount points not already writable into readonlyPaths (root.readonly alone doesn't cover them)", () => {
    const hostMounts = [
      { mountPoint: "/", fsType: "ext4" },
      { mountPoint: "/proc", fsType: "proc" },
      { mountPoint: "/mnt", fsType: "ext4" },
      { mountPoint: baseArgs.workdir, fsType: "ext4" },
    ];
    const config = buildOciConfig(fakeBaseSpec(), { ...baseArgs, writablePaths: [], hostMounts });
    assert.ok(config.linux.readonlyPaths.includes("/mnt"), "a real, separate host mount not covered by root.readonly must be listed explicitly");
    assert.ok(!config.linux.readonlyPaths.includes("/"), "'/' itself is already covered by root.readonly");
    assert.ok(!config.linux.readonlyPaths.includes("/proc"), "pseudo-filesystems get their own fresh mount, not a readonly remount of the host copy");
    assert.ok(!config.linux.readonlyPaths.includes(baseArgs.workdir), "workdir must stay writable, not be added to readonlyPaths");
  });

  it("`writable: /` skips the host-mount readonly pass entirely", () => {
    const hostMounts = [{ mountPoint: "/mnt", fsType: "ext4" }];
    const config = buildOciConfig(fakeBaseSpec(), { ...baseArgs, writablePaths: ["/"], hostMounts });
    assert.ok(!config.linux.readonlyPaths.includes("/mnt"));
  });
});

describe("writeOciConfig", () => {
  it("writes valid JSON matching the given config", () => {
    withScratchDir((dir) => {
      const config = { ociVersion: "1.0.2", process: { args: ["/bin/true"] } };
      const path = writeOciConfig(config, dir);
      assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), config);
    });
  });

  it("writes config.json 0600 (process.env can hold secrets from the step's env:)", () => {
    withScratchDir((dir) => {
      const path = writeOciConfig({ process: { env: ["SECRET=s3cr3t"] } }, dir);
      const mode = statSync(path).mode & 0o777;
      assert.equal(mode, 0o600);
    });
  });
});

describe("withScratchDir", () => {
  it("removes the directory after the callback returns", () => {
    let capturedDir;
    withScratchDir((dir) => {
      capturedDir = dir;
      writeRunScript("echo hi", dir);
    });
    assert.throws(() => readFileSync(join(capturedDir, "run-script.sh")));
  });

  it("removes the directory even if the callback throws", () => {
    let capturedDir;
    assert.throws(() => {
      withScratchDir((dir) => {
        capturedDir = dir;
        throw new Error("boom");
      });
    });
    assert.throws(() => readFileSync(join(capturedDir, "run-script.sh")));
  });
});

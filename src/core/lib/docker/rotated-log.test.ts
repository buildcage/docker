import { spawn } from "node:child_process";
import { linkSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { afterEach, describe, it, expect } from "vitest";

import type { Docker } from "./client.ts";
import { readRotatedLog } from "./rotated-log.ts";

/** A Docker whose execLines runs the command on this machine instead. */
function localDocker(): Docker {
  return {
    findContainers: () => [],
    copyFromContainer: () => {},
    readEnv: () => ({}),
    readLabels: () => ({}),
    exec: () => "",
    async *execLines(_id, [command, ...args]) {
      const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
      const closed = new Promise<number | null>((resolve) => child.on("close", resolve));
      yield* createInterface({ input: child.stdout });
      if ((await closed) !== 0) throw new Error(`${command} failed`);
    },
  };
}

async function drain(iterable: AsyncIterable<string>): Promise<string[]> {
  const lines: string[] = [];
  for await (const line of iterable) lines.push(line);
  return lines;
}

const OLD = "@400000006a94d9dc0621143f.s";
const MIDDLE = "@400000006a94d9dc09e929d9.s";
const NEWER = "@400000006a94d9dc0aaaaaaa.s";
const NEWEST = "@400000006a94d9dc0bbbbbbb.u";

describe("readRotatedLog", () => {
  it("runs its script in the container with the directory as its argument and in its name", async () => {
    let seen: string[] = [];
    const docker: Docker = {
      ...localDocker(),
      async *execLines(id, args, operation) {
        seen = [id, ...args, operation];
        yield "line";
      },
    };
    expect(await drain(readRotatedLog(docker, "abc123", "/var/log/haproxy"))).toStrictEqual([
      "line",
    ]);
    expect(seen).toStrictEqual([
      "abc123",
      "sh",
      "-c",
      expect.any(String),
      "sh",
      "/var/log/haproxy",
      "reading /var/log/haproxy",
    ]);
  });
});

// The script needs /proc and GNU or busybox stat, as in the proxy image.
describe.runIf(process.platform === "linux")("readRotatedLog's script", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function logDir(files: Record<string, string>): string {
    dir = mkdtempSync(join(tmpdir(), "rotated-log-"));
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
    return dir;
  }
  const read = (path: string) => drain(readRotatedLog(localDocker(), "id", path));

  it("reads the archives oldest first, then current", async () => {
    const path = logDir({ current: "c\n", [MIDDLE]: "m\n", [OLD]: "o\n", lock: "", state: "" });
    expect(await read(path)).toStrictEqual(["o", "m", "c"]);
  });

  it("orders archives by name past ten of them", async () => {
    const names = Array.from({ length: 15 }, (_, i) => `@${i.toString(16).padStart(24, "0")}.s`);
    const path = logDir(Object.fromEntries([...names].reverse().map((n) => [n, `${n}\n`])));
    writeFileSync(join(path, "current"), "c\n");
    expect(await read(path)).toStrictEqual([...names, "c"]);
  });

  it("reads previous after the archives, once while it also has its archive name", async () => {
    const path = logDir({ current: "c\n", [OLD]: "o\n", previous: "p\n" });
    linkSync(join(path, "previous"), join(path, NEWER));
    expect(await read(path)).toStrictEqual(["o", "p", "c"]);
  });

  it("stops at the file it opened as current once that has rotated", async () => {
    const path = logDir({ current: "c\n", [OLD]: "o\n" });
    linkSync(join(path, "current"), join(path, "previous"));
    linkSync(join(path, "current"), join(path, NEWER));
    writeFileSync(join(path, NEWEST), "after\n");
    expect(await read(path)).toStrictEqual(["o", "c"]);
  });

  it("ends an archive's cut-short last line before the next segment", async () => {
    const path = logDir({ current: "c\n", [OLD]: "o\ncut", [MIDDLE]: "m\n" });
    expect(await read(path)).toStrictEqual(["o", "cut", "m", "c"]);
  });

  it("reads every archive when there is no current", async () => {
    expect(await read(logDir({ [OLD]: "o\n", [MIDDLE]: "m\n" }))).toStrictEqual(["o", "m"]);
  });

  it("reads current written while it waits for one", async () => {
    const path = logDir({ [OLD]: "o\n" });
    setTimeout(() => writeFileSync(join(path, "current"), "c\n"), 300);
    expect(await read(path)).toStrictEqual(["o", "c"]);
  });

  it("fails on a directory that is not there", async () => {
    dir = mkdtempSync(join(tmpdir(), "rotated-log-"));
    await expect(read(join(dir, "missing"))).rejects.toThrow();
  });

  it("reads nothing from an empty directory", async () => {
    dir = mkdtempSync(join(tmpdir(), "rotated-log-"));
    mkdirSync(join(dir, "log"));
    expect(await read(join(dir, "log"))).toStrictEqual([]);
  });
});

import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import { parseLogSegments, readRotatedLog } from "./rotated-log.ts";
import type { Docker } from "./client.ts";

describe("parseLogSegments", () => {
  it("keeps only s6-log segment names, archives before current", () => {
    const ls = [
      "state",
      "lock",
      "@400000006a94d9dc0621143f.s",
      "current",
      "@400000006a94d9dc09e929d9.s",
    ].join("\n");
    expect(parseLogSegments(ls)).toStrictEqual([
      "@400000006a94d9dc0621143f.s",
      "@400000006a94d9dc09e929d9.s",
      "current",
    ]);
  });

  it("sorts archives chronologically by their TAI64N name", () => {
    const ls = ["@400000006a94d9dc09e929d9.s", "@400000006a94d9dc0621143f.s"].join("\n");
    expect(parseLogSegments(ls)).toStrictEqual([
      "@400000006a94d9dc0621143f.s",
      "@400000006a94d9dc09e929d9.s",
    ]);
  });

  it("returns just current when nothing has rotated yet", () => {
    expect(parseLogSegments("current\nlock\nstate\n")).toStrictEqual(["current"]);
  });

  it("returns an empty array when current itself is absent", () => {
    expect(parseLogSegments("lock\nstate\n")).toStrictEqual([]);
  });

  // Archive names are a fixed-width 24-hex-digit TAI64N timestamp, not a
  // decimal counter, so there's no "10" sorting before "9" the way there
  // would be for variable-width numbers -- string order already is
  // chronological order, however many archives exist. n100 (see the
  // haproxy-log/coredns-log run scripts) means a build can genuinely produce
  // more than 10, so this is exercised past double digits, not just at 2.
  it("keeps chronological order past double-digit archive counts", () => {
    const inOrder = Array.from({ length: 15 }, (_, i) => `@${i.toString(16).padStart(24, "0")}.s`);
    const shuffled = [...inOrder].reverse();
    expect(parseLogSegments(shuffled.join("\n"))).toStrictEqual(inOrder);
  });
});

/** Minimal stand-in for Docker, just enough surface for readRotatedLog. */
function fakeDocker(
  lsOutput: string,
  files: Record<string, string[]>,
): { docker: Docker; reads: string[] } {
  const reads: string[] = [];
  const docker: Docker = {
    findContainers: () => [],
    copyFromContainer: () => {},
    readEnv: () => ({}),
    readLabels: () => ({}),
    exec: (_id, args) => {
      if (args[0] === "ls") return lsOutput;
      throw new Error(`unexpected exec: ${args.join(" ")}`);
    },
    async *readFileLines(_id, path) {
      reads.push(path);
      for (const line of files[path] ?? []) yield line;
    },
  };
  return { docker, reads };
}

async function drain(iterable: AsyncIterable<string>): Promise<string[]> {
  const lines: string[] = [];
  for await (const line of iterable) lines.push(line);
  return lines;
}

describe("readRotatedLog", () => {
  it("reads archives oldest-first, then current, all concatenated", async () => {
    const ls = ["current", "@400000006a94d9dc09e929d9.s", "@400000006a94d9dc0621143f.s"].join("\n");
    const { docker, reads } = fakeDocker(ls, {
      "/var/log/haproxy/@400000006a94d9dc0621143f.s": ["old line"],
      "/var/log/haproxy/@400000006a94d9dc09e929d9.s": ["middle line"],
      "/var/log/haproxy/current": ["newest line"],
    });
    const lines = await drain(readRotatedLog(docker, "abc123", "/var/log/haproxy"));
    expect(lines).toStrictEqual(["old line", "middle line", "newest line"]);
    expect(reads).toStrictEqual([
      "/var/log/haproxy/@400000006a94d9dc0621143f.s",
      "/var/log/haproxy/@400000006a94d9dc09e929d9.s",
      "/var/log/haproxy/current",
    ]);
  });

  it("reads just current when nothing has rotated", async () => {
    const { docker } = fakeDocker("current\nlock\nstate\n", {
      "/var/log/coredns/current": ["a", "b"],
    });
    const lines = await drain(readRotatedLog(docker, "abc123", "/var/log/coredns"));
    expect(lines).toStrictEqual(["a", "b"]);
  });

  it("lists the directory via docker exec ls -1", async () => {
    let seenArgs: string[] = [];
    const docker: Docker = {
      findContainers: () => [],
      copyFromContainer: () => {},
      readEnv: () => ({}),
      readLabels: () => ({}),
      exec: (_id, args) => {
        seenArgs = args;
        return "current\n";
      },
      async *readFileLines() {},
    };
    await drain(readRotatedLog(docker, "abc123", "/var/log/haproxy"));
    expect(seenArgs).toStrictEqual(["ls", "-1", "/var/log/haproxy"]);
  });
});

reportResults();

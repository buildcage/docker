import { describe, it, expect } from "vitest";

import type { Docker } from "./client.ts";
import { parseDroppedLogs, readProxyDroppedLogs } from "./proxy-dropped-logs.ts";

/** What haproxy 3.4's exporter serves for `?scope=global`, trimmed to the
 *  counter and its neighbours. */
const METRICS = [
  "# HELP haproxy_process_current_zlib_memory Current memory used for zlib in bytes.",
  "# TYPE haproxy_process_current_zlib_memory gauge",
  "haproxy_process_current_zlib_memory 0",
  "# HELP haproxy_process_dropped_logs_total Total number of dropped logs for current worker process since started",
  "# TYPE haproxy_process_dropped_logs_total counter",
  "haproxy_process_dropped_logs_total 12",
  "# HELP haproxy_process_busy_polling_enabled 1 if busy-polling is currently in use, 0 otherwise.",
  "haproxy_process_busy_polling_enabled 0",
].join("\n");

function fakeDocker(exec: Docker["exec"]): { docker: Docker; calls: string[][] } {
  const calls: string[][] = [];
  const docker: Docker = {
    findContainers: () => [],
    copyFromContainer: () => {},
    readEnv: () => ({}),
    readLabels: () => ({}),
    exec: (id, args) => {
      calls.push([id, ...args]);
      return exec(id, args);
    },
    async *readFileLines() {
      yield* [];
    },
  };
  return { docker, calls };
}

describe("parseDroppedLogs", () => {
  it("reads the counter out of the exporter's text", () => {
    expect(parseDroppedLogs(METRICS)).toBe(12);
  });

  it("reads a zero as zero, not as missing", () => {
    expect(parseDroppedLogs("haproxy_process_dropped_logs_total 0\n")).toBe(0);
  });

  it("finds no counter in its HELP line alone", () => {
    expect(
      parseDroppedLogs("# HELP haproxy_process_dropped_logs_total Total number of dropped logs"),
    ).toBe(undefined);
  });

  it("returns undefined for output that carries no counter", () => {
    expect(parseDroppedLogs("")).toBe(undefined);
  });
});

/** Answers the barrier with `barrier` and the metrics request with `metrics`. */
function byCommand(barrier: () => string, metrics: () => string): Docker["exec"] {
  return (_id, args) => (args[0] === "sh" ? barrier() : metrics());
}

function fail(): string {
  throw new Error("exit 1");
}

describe("readProxyDroppedLogs", () => {
  it("waits for its barrier line in the log, then asks the health socket", () => {
    const { docker, calls } = fakeDocker(() => METRICS);
    expect(readProxyDroppedLogs(docker, "abc", "f00d")).toStrictEqual({
      answered: true,
      count: 12,
    });
    expect(calls.length).toBe(2);
    const [id, sh, flag, script, name, token, line] = calls[0];
    expect([id, sh, flag, name, token, line]).toStrictEqual([
      "abc",
      "sh",
      "-c",
      "sh",
      "f00d",
      "buildcage log barrier ?f00d",
    ]);
    expect(script).toContain("--unix-socket /var/run/haproxy-barrier.sock");
    expect(script).toContain("/var/log/haproxy/current");
    expect(calls[1]).toStrictEqual([
      "abc",
      "curl",
      "-sf",
      "--max-time",
      "10",
      "--unix-socket",
      "/var/run/haproxy-health.sock",
      "http://localhost/metrics?scope=global",
    ]);
  });

  it("makes up a fresh barrier each time it is not given one", () => {
    const { docker, calls } = fakeDocker(() => METRICS);
    readProxyDroppedLogs(docker, "abc");
    readProxyDroppedLogs(docker, "abc");
    const [first, second] = [calls[0][5], calls[2][5]];
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(second === first).toBe(false);
  });

  it("leaves the count unknown when the log never caught up with the barrier", () => {
    const { docker } = fakeDocker(byCommand(fail, () => "haproxy_process_dropped_logs_total 0"));
    expect(readProxyDroppedLogs(docker, "abc")).toStrictEqual({ answered: true, count: undefined });
  });

  it("tells a proxy that answered without the counter from one that did not answer", () => {
    expect(readProxyDroppedLogs(fakeDocker(() => "").docker, "abc")).toStrictEqual({
      answered: true,
      count: undefined,
    });
    const { docker } = fakeDocker(() => {
      throw new Error("exit 7");
    });
    expect(readProxyDroppedLogs(docker, "abc")).toStrictEqual({
      answered: false,
      count: undefined,
    });
  });
});

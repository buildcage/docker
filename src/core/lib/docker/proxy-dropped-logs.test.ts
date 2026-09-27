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

describe("readProxyDroppedLogs", () => {
  it("asks the health socket inside the container", () => {
    const { docker, calls } = fakeDocker(() => METRICS);
    expect(readProxyDroppedLogs(docker, "abc")).toBe(12);
    expect(calls).toStrictEqual([
      [
        "abc",
        "curl",
        "-sf",
        "--max-time",
        "10",
        "--unix-socket",
        "/var/run/haproxy-health.sock",
        "http://localhost/metrics?scope=global",
      ],
    ]);
  });

  it("returns undefined when the proxy does not answer", () => {
    const { docker } = fakeDocker(() => {
      throw new Error("exit 7");
    });
    expect(readProxyDroppedLogs(docker, "abc")).toBe(undefined);
  });
});

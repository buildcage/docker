import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import type { Docker } from "./client.ts";
import { parseDroppedLogs, readProxyAnswered, readProxyHealth } from "./proxy-health.ts";

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
    async *execLines() {
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

/** Answers the barrier with `barrier`, the metrics request with `metrics` and
 *  the read of the log writer's connections with `connections`. */
function byCommand(
  barrier: () => string,
  metrics: () => string,
  connections: () => string = () => "\n",
): Docker["exec"] {
  return (_id, args) =>
    args[0] === "sh" ? barrier() : args[0] === "cat" ? connections() : metrics();
}

function fail(): string {
  throw new Error("exit 1");
}

describe("readProxyHealth", () => {
  it("waits for its barrier line in the log, asks the health socket, then counts log connections", () => {
    const { docker, calls } = fakeDocker(
      byCommand(
        () => "",
        () => METRICS,
      ),
    );
    expect(readProxyHealth(docker, "abc", "f00d")).toStrictEqual({
      answered: true,
      droppedLines: 12,
      logConnections: 1,
    });
    expect(calls.length).toBe(3);
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
    expect(calls[2]).toStrictEqual(["abc", "cat", "/var/run/haproxy-log/connections"]);
  });

  it("makes up a fresh barrier each time it is not given one", () => {
    const { docker, calls } = fakeDocker(() => METRICS);
    readProxyHealth(docker, "abc");
    readProxyHealth(docker, "abc");
    const [first, second] = [calls[0][5], calls[3][5]];
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(second === first).toBe(false);
  });

  it("leaves the count unknown when the log never caught up with the barrier", () => {
    const { docker } = fakeDocker(byCommand(fail, () => "haproxy_process_dropped_logs_total 0"));
    expect(readProxyHealth(docker, "abc")).toStrictEqual({
      answered: true,
      droppedLines: undefined,
      logConnections: 1,
    });
  });

  it("counts one log connection per line, and leaves an empty or unreadable file unknown", () => {
    const count = (connections: () => string) =>
      readProxyHealth(
        fakeDocker(
          byCommand(
            () => "",
            () => METRICS,
            connections,
          ),
        ).docker,
        "abc",
      ).logConnections;
    expect(count(() => "\n\n\n")).toBe(3);
    expect(count(() => "")).toBe(undefined);
    expect(count(fail)).toBe(undefined);
  });

  it("tells a proxy that answered without the counter from one that did not answer", () => {
    const silent = fakeDocker(
      byCommand(
        () => "",
        () => "",
      ),
    );
    expect(readProxyHealth(silent.docker, "abc")).toStrictEqual({
      answered: true,
      droppedLines: undefined,
      logConnections: 1,
    });
    const { docker } = fakeDocker(() => {
      throw new Error("exit 7");
    });
    expect(readProxyHealth(docker, "abc")).toStrictEqual({
      answered: false,
      droppedLines: undefined,
      logConnections: undefined,
    });
  });

  it("asks only the health socket when it needs to know whether the proxy answers", () => {
    const { docker, calls } = fakeDocker(() => METRICS);
    expect(readProxyAnswered(docker, "abc")).toBe(true);
    expect(calls.map((call) => call[1])).toStrictEqual(["curl"]);
    expect(readProxyAnswered(fakeDocker(fail).docker, "abc")).toBe(false);
  });

  it("logs its barrier only once the log has stopped growing", () => {
    const dir = mkdtempSync(join(tmpdir(), "barrier-"));
    const fake = (name: string, body: string[]): void => {
      writeFileSync(join(dir, name), ["#!/bin/sh", ...body].join("\n"));
      chmodSync(join(dir, name), 0o755);
    };
    try {
      mkdirSync(join(dir, "log"));
      // The log grows for the first five looks, then stays at the fifth size.
      fake("stat", [
        'echo stat >> "$CALLS"',
        'n=$(grep -c stat "$CALLS")',
        '[ "$n" -gt 5 ] && n=5',
        'echo "$n"',
      ]);
      fake("curl", ['echo "curl $*" >> "$CALLS"', 'echo "$BARRIER" >> "$LOG/current"']);
      const { docker, calls } = fakeDocker(() => METRICS);
      readProxyHealth(docker, "abc", "f00d");
      const [, , , script, ...args] = calls[0];
      execFileSync("sh", ["-c", script.replaceAll("/var/log/haproxy", "$LOG"), ...args], {
        env: {
          PATH: `${dir}:${process.env.PATH}`,
          CALLS: join(dir, "calls"),
          LOG: join(dir, "log"),
          BARRIER: "buildcage log barrier ?f00d",
        },
      });
      expect(readFileSync(join(dir, "calls"), "utf8").split("\n")).toStrictEqual([
        ...Array<string>(10).fill("stat"),
        "curl -sf --max-time 10 --unix-socket /var/run/haproxy-barrier.sock http://localhost/?f00d",
        "",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

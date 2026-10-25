/**
 * How many lines the proxy failed to write to its own log, read from its own
 * counter when the report runs.
 *
 * haproxy writes each line to a pipe without blocking, and a line it cannot
 * write at once is dropped with nothing left in the log to mark where. Neither
 * the startup marker nor an unreadable line can reveal that, so a build that
 * floods the pipe could otherwise hide a connection among the lines it lost.
 */
import type { Docker } from "./client.ts";

/** Served by the proxy's `health` frontend; see haproxy-sections.ts. */
const SOCKET = "/var/run/haproxy-health.sock";
const URL = "http://localhost/metrics?scope=global";
const COUNTER = /^haproxy_process_dropped_logs_total (\d+)$/m;
/** A wedged proxy can accept the connection and never answer. */
const MAX_TIME_SECONDS = "10";

/** The counter's value in Prometheus text output, or undefined without one. */
export function parseDroppedLogs(metrics: string): number | undefined {
  const match = COUNTER.exec(metrics);
  return match ? Number(match[1]) : undefined;
}

/** The proxy's dropped-line count, or undefined where it could not be read. */
export function readProxyDroppedLogs(docker: Docker, containerId: string): number | undefined {
  try {
    return parseDroppedLogs(
      docker.exec(containerId, [
        "curl",
        "-sf",
        "--max-time",
        MAX_TIME_SECONDS,
        "--unix-socket",
        SOCKET,
        URL,
      ]),
    );
  } catch {
    return undefined;
  }
}

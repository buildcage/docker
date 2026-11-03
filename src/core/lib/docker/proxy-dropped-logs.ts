/**
 * Whether the proxy lost any line of its log, asked when the report runs and
 * before it reads the log.
 *
 * haproxy writes each line without blocking, and a line it cannot write at
 * once is dropped. Its own counter covers a line that never reached the log
 * ring. One the full ring dropped is counted only by a notice in the log
 * itself (proxy-log-tally.ts), written on the next line that fits, so the
 * report logs one more line once the log goes quiet and waits for it: that
 * flushes the notice and everything ahead of it into the log the report then
 * reads. Lines the log writer took and then died with are counted by its
 * connections, read once that barrier is in.
 */
import { randomBytes } from "node:crypto";

import { PROXY_LOG_BARRIER } from "../log/proxy-notices.ts";
import type { Docker } from "./client.ts";

/** Served by the proxy's `health` frontend; see haproxy-sections.ts. */
const SOCKET = "/var/run/haproxy-health.sock";
const URL = "http://localhost/metrics?scope=global";
const COUNTER = /^haproxy_process_dropped_logs_total (\d+)$/m;
/** A wedged proxy can accept the connection and never answer. */
const MAX_TIME_SECONDS = "10";

/** Served by the proxy's `log_barrier` frontend; see haproxy-sections.ts. */
const BARRIER_SOCKET = "/var/run/haproxy-barrier.sock";
const LOG_DIR = "/var/log/haproxy";
/** One line per connection to the log writer; see haproxy-log/run. */
const CONNECTIONS = "/var/run/haproxy-log/connections";
/**
 * Waits up to 10s for `current` to stop growing for half a second, as a ring
 * still full would drop the barrier line too. Then polls `current` for up to
 * 10s, and searches every segment once, in case the line arrived just before
 * a rotation.
 */
const BARRIER_SCRIPT = [
  "i=0",
  "still=0",
  "last=",
  "while [ $i -lt 100 ] && [ $still -lt 5 ]; do",
  `  size=$(stat -c %s ${LOG_DIR}/current 2>/dev/null)`,
  '  if [ "$size" = "$last" ]; then still=$((still + 1)); else still=0; last=$size; fi',
  "  sleep 0.1",
  "  i=$((i + 1))",
  "done",
  `curl -sf --max-time ${MAX_TIME_SECONDS} --unix-socket ${BARRIER_SOCKET} "http://localhost/?$1" >/dev/null || exit 1`,
  "i=0",
  "while [ $i -lt 100 ]; do",
  `  grep -qsF "$2" ${LOG_DIR}/current && exit 0`,
  "  sleep 0.1",
  "  i=$((i + 1))",
  "done",
  `grep -rqsF "$2" ${LOG_DIR}`,
].join("\n");

/** What the report learned from asking the proxy for its dropped-line count. */
export interface ProxyDroppedLogs {
  /** False when the proxy did not answer at all: it stopped during the run and
   *  stayed down, or hung. */
  answered: boolean;
  /** The count, or undefined where it could not be read or the log did not
   *  catch up. */
  count: number | undefined;
  /** How many times the proxy connected to its log writer, or undefined
   *  where that could not be read. */
  logConnections: number | undefined;
}

/** The counter's value in Prometheus text output, or undefined without one. */
export function parseDroppedLogs(metrics: string): number | undefined {
  const match = COUNTER.exec(metrics);
  return match ? Number(match[1]) : undefined;
}

/** True once a line the proxy logs on request has reached its log. */
function awaitProxyLog(docker: Docker, containerId: string, token: string): boolean {
  try {
    docker.exec(containerId, [
      "sh",
      "-c",
      BARRIER_SCRIPT,
      "sh",
      token,
      `${PROXY_LOG_BARRIER} ?${token}`,
    ]);
    return true;
  } catch {
    return false;
  }
}

/** The proxy's dropped-line count, and whether it answered at all. */
export function readProxyDroppedLogs(
  docker: Docker,
  containerId: string,
  token = randomBytes(16).toString("hex"),
): ProxyDroppedLogs {
  const caughtUp = awaitProxyLog(docker, containerId, token);
  let metrics: string;
  try {
    metrics = docker.exec(containerId, [
      "curl",
      "-sf",
      "--max-time",
      MAX_TIME_SECONDS,
      "--unix-socket",
      SOCKET,
      URL,
    ]);
  } catch {
    return { answered: false, count: undefined, logConnections: undefined };
  }
  return {
    answered: true,
    count: caughtUp ? parseDroppedLogs(metrics) : undefined,
    logConnections: readLogConnections(docker, containerId),
  };
}

function readLogConnections(docker: Docker, containerId: string): number | undefined {
  try {
    return docker.exec(containerId, ["cat", CONNECTIONS]).split("\n").length - 1;
  } catch {
    return undefined;
  }
}

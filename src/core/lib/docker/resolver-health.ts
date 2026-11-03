/**
 * Whether the resolver still answers when the report runs.
 *
 * A lookup the resolver never received leaves no line in its log, and its log
 * is the only trace of a name looked up but never connected to. A resolver
 * that stopped mid-run would otherwise leave a log that reads as whole. So
 * would a log writer that died with lines it had not written.
 */
import type { Docker } from "./client.ts";

/** CoreDNS's health plugin; see coredns-config.ts. */
const URL = "http://127.0.0.1:8080/health";
/** A wedged resolver can accept the connection and never answer. */
const MAX_TIME_SECONDS = "10";

/** s6-supervise's directory for the resolver's log writer. A CoreDNS restart
 *  leaves that service running, so each death it records is the writer's. */
const LOG_SERVICE = "/run/service/coredns-log";

/** How many times the resolver's log writer died, or undefined where that
 *  could not be read. s6-supervise records a death as it happens, so one the
 *  writer has not yet come back from counts too. */
export function readResolverLogDeaths(docker: Docker, containerId: string): number | undefined {
  try {
    return docker.exec(containerId, ["s6-svdt", LOG_SERVICE]).split("\n").length - 1;
  } catch {
    return undefined;
  }
}

/** Whether the resolver answered its health check. */
export function readResolverAnswered(docker: Docker, containerId: string): boolean {
  try {
    docker.exec(containerId, ["curl", "-sf", "--max-time", MAX_TIME_SECONDS, URL]);
    return true;
  } catch {
    return false;
  }
}

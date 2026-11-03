/**
 * Whether the resolver still answers when the report runs.
 *
 * A lookup the resolver never received leaves no line in its log, and its log
 * is the only trace of a name looked up but never connected to. A resolver
 * that stopped mid-run would otherwise leave a log that reads as whole. So
 * would a log writer that died with lines it had not written.
 */
import type { Docker } from "./client.ts";
import { readStartLedger } from "./start-ledger.ts";

/** CoreDNS's health plugin; see coredns-config.ts. */
const URL = "http://127.0.0.1:8080/health";
/** A wedged resolver can accept the connection and never answer. */
const MAX_TIME_SECONDS = "10";

/** One line per start of the resolver's log writer; see coredns-log/run. */
const LOG_STARTS = "/var/run/coredns-log/starts";

/** How many times the resolver's log writer started, or undefined where that
 *  could not be read (start-ledger.ts). */
export function readResolverLogStarts(docker: Docker, containerId: string): number | undefined {
  return readStartLedger(docker, containerId, LOG_STARTS);
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

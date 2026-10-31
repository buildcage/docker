/**
 * Whether the resolver still answers when the report runs.
 *
 * A lookup the resolver never received leaves no line in its log, and its log
 * is the only trace of a name looked up but never connected to. A resolver
 * that stopped mid-run would otherwise leave a log that reads as whole.
 */
import type { Docker } from "./client.ts";

/** CoreDNS's health plugin; see coredns-config.ts. */
const URL = "http://127.0.0.1:8080/health";
/** A wedged resolver can accept the connection and never answer. */
const MAX_TIME_SECONDS = "10";

/** Whether the resolver answered its health check. */
export function readResolverAnswered(docker: Docker, containerId: string): boolean {
  try {
    docker.exec(containerId, ["curl", "-sf", "--max-time", MAX_TIME_SECONDS, URL]);
    return true;
  } catch {
    return false;
  }
}

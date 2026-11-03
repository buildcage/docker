/**
 * The files a log writer's run script appends one line to per start or
 * connection, so the report can tell a writer that died mid-run.
 */
import type { Docker } from "./client.ts";

/**
 * How many lines `path` holds, or undefined where it cannot be read or holds
 * none: its writer adds a line before it takes any log, so an empty file
 * cannot vouch for the log either.
 */
export function readStartLedger(
  docker: Docker,
  containerId: string,
  path: string,
): number | undefined {
  try {
    return docker.exec(containerId, ["cat", path]).split("\n").length - 1 || undefined;
  } catch {
    return undefined;
  }
}

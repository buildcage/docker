/**
 * Lines the proxy log carries that are neither an event nor the startup
 * marker. Shared by the config generator that makes haproxy write them and
 * the parsers that read them back.
 */

/** Opens the line the report asks the proxy to log, then waits to see; see
 *  proxy-dropped-logs.ts. */
export const PROXY_LOG_BARRIER = "buildcage log barrier";

/** What haproxy writes into its ring after it had to drop lines there, on the
 *  next line it does fit (sink_announce_dropped). */
const RING_DROPPED = /^(\d+) events? dropped$/;

/** How many lines a ring drop announcement says were lost, or undefined for
 *  any other line. */
export function ringDropped(trimmed: string): number | undefined {
  const match = RING_DROPPED.exec(trimmed);
  return match ? Number(match[1]) : undefined;
}

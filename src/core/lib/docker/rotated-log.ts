/**
 * Reads an s6-log directory as one time-ordered stream: the rotated archive
 * segments (`@<TAI64N>.<letter>`, oldest first) followed by `current`.
 *
 * s6-log rotates `current` once it crosses its configured size, moving the
 * old content into a new `@<timestamp>.<letter>` file in the same
 * directory (see the haproxy-log/coredns-log `run` scripts). Reading only
 * `current` silently drops everything before the last rotation once a build
 * produces enough log traffic to cross that threshold — this is what report
 * generation did before this file existed.
 */
import type { Docker } from "./client.ts";

const SEGMENT = /^@[0-9a-f]{24}\.[a-z]$/;

/**
 * Extract the log segment filenames from `ls -1 <dir>` output, oldest first,
 * with `current` last if present. Anything else (`lock`, `state`, s6's other
 * bookkeeping files) is dropped by not matching either pattern.
 *
 * TAI64N timestamps are fixed-width hex, so a plain string sort already puts
 * the archives in chronological order.
 */
export function parseLogSegments(lsOutput: string): string[] {
  const entries = lsOutput
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const segments = entries.filter((name) => SEGMENT.test(name)).sort();
  if (entries.includes("current")) segments.push("current");
  return segments;
}

/**
 * Read every segment in `dir` as one time-ordered line stream: oldest
 * rotated archive first, `current` last. See the module doc comment for why
 * this exists instead of reading `current` alone.
 */
export async function* readRotatedLog(
  docker: Docker,
  containerId: string,
  dir: string,
): AsyncIterable<string> {
  const listing = docker.exec(containerId, ["ls", "-1", dir]);
  for (const name of parseLogSegments(listing)) {
    yield* docker.readFileLines(containerId, `${dir}/${name}`);
  }
}

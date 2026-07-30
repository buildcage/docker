/**
 * Parse buildkitd's own debug log for source-policy denial entries.
 *
 * BuildKit's sourcepolicy engine logs a Debug-level "Evaluated source policy"
 * line (logrus text format) whenever a rule denies (or converts) a source —
 * see sourcepolicy/engine.go's evaluatePolicy(). ALLOW decisions are never
 * logged this way. This entry is written by buildkitd's own structured
 * logger and needs no special buildkitd configuration to appear.
 *
 * Real observed line shape (moby/buildkit v0.31.1):
 *   time="2026-07-05T02:26:34Z" level=debug msg="Evaluated source policy"
 *     error="source \"https://blocked.example.com/\" denied by policy: source denied by policy"
 *     mutated=false orig="identifier:\"https://blocked.example.com/\""
 *     ref="https://blocked.example.com/" updated="https://blocked.example.com/"
 *
 * Allowed requests are not parsed from this file. BuildKit's own "proxy
 * network requests:" summary (see solver/llbsolver/ops/exec.go's
 * logProxyRequests()) only appears here when buildkitd runs with
 * BUILDKIT_DEBUG_EXEC_OUTPUT=1, which also mirrors every RUN step's own
 * console output into this same log.
 */
import { parseIdentifier } from "./parse-identifier.ts";

export interface DenialEntry {
  decision: string;
  ruleType: string;
  host: string;
  port: string;
  reason: string;
}

export interface DenialTimelineEntry {
  url: string;
  timestamp: string;
}

const deniedLinePattern = /msg="Evaluated source policy".*denied by policy/;
const refFieldPattern = /\bref="((?:[^"\\]|\\.)*)"/;
const timeFieldPattern = /^time="([^"]*)"/;

// Shared for logrus text-format quoted values ("ref=\"...\"", "span=\"...\""),
// which escape embedded quotes as \" and backslashes as \\.
function unescapeLogrusValue(s: string): string {
  return s.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

/**
 * Scan for "Evaluated source policy" denial lines and return each one's raw
 * identifier and timestamp, in log order, with no host/port resolution or
 * aggregation. Shared by parseEntries() (host-aggregated) and
 * parseDenialTimeline() (chronological) below.
 */
function parseDenialEntries(logText: string): DenialTimelineEntry[] {
  const entries: DenialTimelineEntry[] = [];
  for (const line of logText.split("\n")) {
    if (!deniedLinePattern.test(line)) continue;
    const refMatch = line.match(refFieldPattern);
    const timeMatch = line.match(timeFieldPattern);
    if (!refMatch || !timeMatch) continue;
    entries.push({ url: unescapeLogrusValue(refMatch[1]), timestamp: timeMatch[1] });
  }
  return entries;
}

export function parseEntries(logText: string): DenialEntry[] {
  const entries: DenialEntry[] = [];
  for (const { url } of parseDenialEntries(logText)) {
    const parsed = parseIdentifier(url);
    if (!parsed) continue;
    entries.push({
      decision: "BLOCKED",
      ruleType: parsed.scheme === "https" ? "HTTPS" : "HTTP",
      host: parsed.host,
      port: parsed.port,
      reason: "not-allowed",
    });
  }
  return entries;
}

/**
 * Parse the chronological list of denied requests, each with its own
 * timestamp — unlike parseEntries(), this is neither aggregated by host nor
 * attributed to a RUN step (BuildKit's own denial log carries no vertex/span
 * identifier to attribute it with). Timestamps are whole-seconds only (no
 * sub-second precision), since that is all buildkitd's own logrus text
 * formatter records.
 */
export function parseDenialTimeline(logText: string): DenialTimelineEntry[] {
  return parseDenialEntries(logText);
}

/**
 * True iff logText contains at least one non-blank line that is not a
 * denial line. buildkitd emits copious startup/worker/gRPC debug output
 * (level = "debug" is set unconditionally) from the moment the process
 * starts, regardless of whether any build ever ran or any denial ever
 * occurred. A log consisting only of forged denial lines — or nothing at
 * all — lacks this, which is a signal (not a guarantee) that the log may
 * have been tampered with rather than reflecting a real run.
 */
export function hasNonDenialContent(logText: string): boolean {
  return logText.split("\n").some((line) => line.trim() !== "" && !deniedLinePattern.test(line));
}

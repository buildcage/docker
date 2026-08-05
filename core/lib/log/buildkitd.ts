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
import { createIncrementalAggregator, type AggregatedEntry } from "./aggregate.ts";

export interface DenialTimelineEntry {
  url: string;
  timestamp: string;
}

export interface BuildkitdLogScanResult {
  blocked: AggregatedEntry[];
  /** Chronological, per-event — not aggregated, since each entry's own
   *  timestamp is what a timeline render needs. */
  denied: DenialTimelineEntry[];
  /** True iff a non-blank line wasn't a denial line — see the module doc
   *  below for what this signals. */
  hasNonDenialContent: boolean;
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
 * Single forward pass over buildkitd's own debug log: denial lines fold
 * into an incremental aggregator and also push onto a raw chronological
 * `denied` list; non-denial, non-blank lines flip hasNonDenialContent.
 *
 * buildkitd emits copious debug output from the moment it starts,
 * regardless of whether any denial ever occurred. A log consisting only of
 * forged denial lines — or nothing at all — lacks that, which is a signal
 * (not a guarantee) of tampering.
 */
export async function scanBuildkitdLog(
  lines: AsyncIterable<string> | Iterable<string>,
): Promise<BuildkitdLogScanResult> {
  const blocked = createIncrementalAggregator();
  const denied: DenialTimelineEntry[] = [];
  let hasNonDenialContent = false;

  for await (const line of lines) {
    if (!deniedLinePattern.test(line)) {
      if (line.trim() !== "") hasNonDenialContent = true;
      continue;
    }
    const refMatch = line.match(refFieldPattern);
    const timeMatch = line.match(timeFieldPattern);
    if (!refMatch || !timeMatch) continue;

    const url = unescapeLogrusValue(refMatch[1]);
    denied.push({ url, timestamp: timeMatch[1] });

    const parsed = parseIdentifier(url);
    if (!parsed) continue;
    blocked.add({
      host: parsed.host,
      port: parsed.port,
      ruleType: parsed.scheme === "https" ? "HTTPS" : "HTTP",
      reason: "not-allowed",
    });
  }

  return { blocked: blocked.toSortedArray(), denied, hasNonDenialContent };
}

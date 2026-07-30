/**
 * Log parsing library for HAProxy buildcage logs. aggregate() lives
 * separately in core/lib/log/aggregate.js and is not re-exported here.
 */
import { createIncrementalAggregator, type AggregatedEntry } from "./aggregate.ts";

export interface HaproxyLogScanResult {
  /** ALLOWED entries in restrict mode, AUDIT entries in audit mode — never
   *  both (see `isAudit`). */
  passed: AggregatedEntry[];
  blocked: AggregatedEntry[];
  /** Raw BLOCKED line count, pre-aggregation — distinct from blocked.length. */
  blockedCount: number;
  /** True iff a non-blank line didn't match the buildcage decision format —
   *  see the module doc below for what this signals. */
  hasNonBuildcageContent: boolean;
}

const logPattern =
  /^\[.*?\]\s+buildcage\s+\[(AUDIT|ALLOWED|BLOCKED)\]\s+\((\w+)\)\s+"([^"]+)"\s*(\S*)/;

/**
 * Single forward pass over the log: matching lines fold directly into
 * incremental aggregators (never collected into a flat array first), and
 * non-matching, non-blank lines flip hasNonBuildcageContent.
 *
 * A genuine HAProxy process always emits some non-buildcage-format output
 * of its own before any traffic occurs. A log with nothing but
 * forged/replayed decision lines — or nothing at all — lacks that, which is
 * a signal (not a guarantee) of tampering.
 *
 * `isAudit` picks which decision counts as "passed" (AUDIT vs ALLOWED); the
 * other one, if it somehow appears, is dropped rather than aggregated.
 */
export async function scanHaproxyLog(
  lines: AsyncIterable<string> | Iterable<string>,
  isAudit: boolean,
): Promise<HaproxyLogScanResult> {
  const passed = createIncrementalAggregator();
  const blocked = createIncrementalAggregator();
  const passedDecision = isAudit ? "AUDIT" : "ALLOWED";
  let blockedCount = 0;
  let hasNonBuildcageContent = false;

  for await (const line of lines) {
    const m = line.match(logPattern);
    if (!m) {
      if (line.trim() !== "") hasNonBuildcageContent = true;
      continue;
    }
    const [, decision, ruleType, hostPort, reason] = m;
    const colonIdx = hostPort.lastIndexOf(":");
    let host: string;
    let port: string;
    if (colonIdx > 0) {
      host = hostPort.substring(0, colonIdx);
      port = hostPort.substring(colonIdx + 1);
    } else {
      host = hostPort;
      port = "0";
    }
    const entry = { host, port, ruleType, reason: reason || "-" };

    if (decision === passedDecision) {
      passed.add(entry);
    } else if (decision === "BLOCKED") {
      blocked.add(entry);
      blockedCount++;
    }
  }

  return {
    passed: passed.toSortedArray(),
    blocked: blocked.toSortedArray(),
    blockedCount,
    hasNonBuildcageContent,
  };
}

import { convertRule } from "#core/lib/acl/wildcard-rules.ts";
import { parseIdentifier } from "#core/lib/log/parse-identifier.ts";
import { aggregate, type AggregatedEntry } from "#core/lib/log/aggregate.ts";
import type { AllowedRequest } from "#core/lib/log/proxy-request-text.ts";

export type BlockedRow = AggregatedEntry;

export interface AnnotatedBlockedRow extends BlockedRow {
  expected: boolean;
}

export interface ExpectedFlag {
  expected: boolean;
}

/**
 * Tag each aggregated blocked-hosts row with `expected: boolean` — true iff
 * its `host:port` matches at least one known_blocked_rules pattern.
 *
 * knownBlockedRules is as returned by parseAndValidateRules.
 */
export function annotateKnownBlocked(
  blockedRows: BlockedRow[],
  knownBlockedRules: string[],
): AnnotatedBlockedRow[] {
  const matchers = knownBlockedRules.map((rule) => new RegExp(convertRule(rule)));
  return blockedRows.map((row) => ({
    ...row,
    expected: matchers.some((re) => re.test(targetOf(row))),
  }));
}

/**
 * What a known_blocked_rules pattern is tested against, normally `host:port`.
 *
 * A row with no port is a refused name, connected to nothing. It is tested as
 * port 0, which `host:*` matches (compiling to `host:\d+`) but `host:443` does
 * not -- right, since no port was involved. Without this a refused name could
 * never be marked expected.
 */
function targetOf(row: BlockedRow): string {
  return `${row.host}:${row.port === "-" ? "0" : row.port}`;
}

/**
 * Build the host-aggregated allowed/audited table from the same per-build
 * vertex data vertex.ts's parseVertexAllowedLog() produces for
 * the per-command breakdown.
 *
 * decision is "ALLOWED" (restrict mode) or "AUDIT" (audit mode).
 */
export interface HasEntries {
  entries: AllowedRequest[];
}

export function aggregateAllowedHosts(builds: HasEntries[][], decision: string): AggregatedEntry[] {
  const entries = [];
  for (const vertices of builds) {
    for (const { entries: vertexEntries } of vertices) {
      for (const { url } of vertexEntries) {
        const parsed = parseIdentifier(url);
        if (!parsed) continue;
        entries.push({
          decision,
          ruleType: parsed.scheme === "https" ? "HTTPS" : "HTTP",
          host: parsed.host,
          port: parsed.port,
          reason: "-",
        });
      }
    }
  }
  return aggregate(entries);
}

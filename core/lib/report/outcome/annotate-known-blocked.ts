import { convertRule } from "../../acl/wildcard-rules.ts";
import type { AggregatedEntry } from "../../log/aggregate.ts";

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
    expected: matchers.some((re) => re.test(`${row.host}:${row.port}`)),
  }));
}

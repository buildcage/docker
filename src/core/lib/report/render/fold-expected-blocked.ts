import type { HostTableRow } from "./host-table.ts";

interface ExpectedGroup {
  rule: string;
  ruleType: string;
  reason: string;
  /** Distinct hosts, not rows: one host blocked on two ports is two rows. */
  hosts: Set<string>;
  count: number;
}

/**
 * Collapse the blocked rows a known_blocked_rules rule matched into one row per
 * rule, below the rows nothing matched. A rule covering noisy traffic then
 * costs the table one line however many hosts it names, and the rows a reader
 * has to act on come first.
 */
export function foldExpectedBlockedRows(rows: HostTableRow[]): HostTableRow[] {
  const unmatched: HostTableRow[] = [];
  const groups = new Map<string, ExpectedGroup>();

  for (const row of rows) {
    if (!row.expected || row.expectedBy === undefined) {
      unmatched.push(row);
      continue;
    }
    // One rule can cover a refused name and a refused connection at once, so
    // ruleType and reason stay in the key rather than one row claiming both.
    const key = `${row.expectedBy}\t${row.ruleType}\t${row.reason}`;
    const group = groups.get(key);
    if (group) {
      group.hosts.add(row.host);
      group.count += row.count;
    } else {
      groups.set(key, {
        rule: row.expectedBy,
        ruleType: row.ruleType,
        reason: row.reason,
        hosts: new Set([row.host]),
        count: row.count,
      });
    }
  }

  const folded = [...groups.values()].sort(compareGroups).map(toRow);
  return [...unmatched, ...folded];
}

/** Busiest first, ties by rule, as the host tables are ordered elsewhere. */
function compareGroups(a: ExpectedGroup, b: ExpectedGroup): number {
  return b.count - a.count || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0);
}

/** The row stands for several host:port pairs, so it carries none of its own;
 *  the rule text already says which ports it covers. */
function toRow(group: ExpectedGroup): HostTableRow {
  return {
    host: group.rule,
    port: "-",
    ruleType: group.ruleType,
    reason: group.reason,
    count: group.count,
    expected: true,
    expectedBy: group.rule,
    display: `${group.rule} (${group.hosts.size} host${group.hosts.size === 1 ? "" : "s"})`,
  };
}

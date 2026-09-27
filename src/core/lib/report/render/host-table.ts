import type { AggregatedEntry } from "#core/lib/log/aggregate.ts";

import { markdownTable, type ColumnFormat } from "./markdown-table.ts";

/**
 * A row of a host table, at whatever stage it reaches the renderer: an
 * aggregated row on its own for the allowed/audited table, annotated by
 * annotateKnownBlocked for the blocked one, and folded by
 * foldExpectedBlockedRows when a rule covers several hosts.
 */
export interface HostTableRow extends AggregatedEntry {
  expected?: boolean;
  /** The known_blocked_rules rule that marked the row expected, which folded
   *  rows are grouped by (see ../build/aggregate.ts). */
  expectedBy?: string;
  /** Host cell text for a row that stands for something other than one
   *  host:port, such as a folded group naming its rule. */
  display?: string;
}

export interface RenderHostTableOptions {
  showReason?: boolean;
  showExpected?: boolean;
}

export function renderHostTable(
  rows: HostTableRow[],
  { showReason = false, showExpected = false }: RenderHostTableOptions = {},
): string {
  const formats: ColumnFormat[] = [
    { key: "host", title: "Host" },
    { key: "ruleType", title: "Rule" },
  ];
  if (showReason) formats.push({ key: "reason", title: "Reason" });
  formats.push({ key: "count", title: "Count", align: "right" });
  if (showExpected) formats.push({ key: "expected", title: "Expected", align: "center" });

  const tableRows = rows.map((r) => ({
    // A name refused by the resolver was never connected to, so it has no port
    // to show and "name:-" would only invite the reader to look for one.
    host: r.display ?? (r.port === "-" ? r.host : `${r.host}:${r.port}`),
    ruleType: r.ruleType,
    reason: r.reason,
    count: r.count,
    expected: r.expected ? "✅" : "",
  }));

  return markdownTable(formats, tableRows);
}

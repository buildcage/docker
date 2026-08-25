import { markdownTable, type ColumnFormat } from "./markdown-table.ts";
import type { AggregatedEntry } from "#core/lib/log/aggregate.ts";

export interface HostTableRow extends Omit<AggregatedEntry, "reason"> {
  reason?: string;
  expected?: boolean;
}

export interface RenderHostTableOptions {
  showReason?: boolean;
  showExpected?: boolean;
}

/**
 * Render aggregated host rows as a GitHub-flavored markdown table.
 */
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
    host: r.port === "-" ? r.host : `${r.host}:${r.port}`,
    ruleType: r.ruleType,
    reason: r.reason,
    count: r.count,
    expected: r.expected ? "✅" : "",
  }));

  return markdownTable(formats, tableRows);
}

import type { AggregatedEntry } from "#core/lib/log/aggregate.ts";

import { codeCell, markdownTable, type ColumnFormat } from "./markdown-table.ts";

/**
 * A row of a host table, at whatever stage it reaches the renderer: an
 * aggregated row on its own for the allowed/audited table, annotated by
 * annotateKnownBlocked for the blocked one, and folded by
 * foldExpectedBlockedRows when a rule covers several hosts.
 */
export interface HostTableRow extends AggregatedEntry {
  expected?: boolean;
  /** The known-blocked-rules rule that marked the row expected, which folded
   *  rows are grouped by (see ../build/aggregate.ts). */
  expectedBy?: string;
  /** Shown after the host, such as the host count of a folded group, whose
   *  host is its rule. */
  note?: string;
  /** The mark on the reason. */
  outcome?: "blocked" | "failed";
}

const OUTCOME_MARK = { blocked: "🚫 ", failed: "⚠️ " } as const;

export interface RenderHostTableOptions {
  showReason?: boolean;
}

export function renderHostTable(
  rows: HostTableRow[],
  { showReason = false }: RenderHostTableOptions = {},
): string {
  const formats: ColumnFormat[] = [
    { key: "host", title: "Host", cell: String },
    { key: "ruleType", title: "Rule" },
  ];
  if (showReason) formats.push({ key: "reason", title: "Reason" });
  formats.push({ key: "count", title: "Count", align: "right" });

  const tableRows = rows.map((r) => ({
    // A name blocked by the resolver was never connected to, so it has no port
    // to show and "name:-" would only invite the reader to look for one.
    host: codeCell(r.port === "-" ? r.host : `${r.host}:${r.port}`) + (r.note ? ` ${r.note}` : ""),
    ruleType: r.ruleType,
    reason: r.outcome ? OUTCOME_MARK[r.outcome] + r.reason : r.reason,
    count: r.count,
  }));

  return markdownTable(formats, tableRows);
}

/** What a traffic report says where the Job Summary's size limit cut a host table. */
export function hostTableTruncationNote(artifactAvailable: boolean): string {
  const rest = artifactAvailable
    ? "the buildcage-traffic artifact uploaded for this run has every request"
    : "set upload-traffic-artifact: true to get every request as a downloadable artifact";
  return `_…truncated: the host tables exceeded GitHub's Job Summary size limit; ${rest}._\n`;
}

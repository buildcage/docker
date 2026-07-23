// @ts-nocheck
import { markdownTable } from "./markdown-table.ts";

/**
 * Render aggregated host rows as a GitHub-flavored markdown table.
 *
 * @param {{host:string, port:string, ruleType:string, reason?:string, count:number, expected?:boolean}[]} rows
 * @param {{showReason?: boolean, showExpected?: boolean}} [options]
 * @returns {string}
 */
export function renderHostTable(rows, { showReason = false, showExpected = false } = {}) {
  const formats = [
    { key: "host", title: "Host" },
    { key: "ruleType", title: "Rule" },
  ];
  if (showReason) formats.push({ key: "reason", title: "Reason" });
  formats.push({ key: "count", title: "Count", align: "right" });
  if (showExpected) formats.push({ key: "expected", title: "Expected", align: "center" });

  const tableRows = rows.map((r) => ({
    host: `${r.host}:${r.port}`,
    ruleType: r.ruleType,
    reason: r.reason,
    count: r.count,
    expected: r.expected ? "✅" : "",
  }));

  return markdownTable(formats, tableRows);
}

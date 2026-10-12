import { countUndecidedRequests } from "../outcome/report-outcomes.ts";
import type { ReportData } from "../types.ts";

/**
 * The line under the report's title that says whether anything needs a look,
 * counted the way the annotations count it. `extraItems` follow the refusals,
 * for a check an action adds of its own.
 */
export function renderVerdict(report: ReportData, extraItems: string[] = []): string {
  let unexpected = 0;
  let expected = 0;
  for (const row of report.blocked) {
    if (row.expected) expected += row.count;
    else unexpected += row.count;
  }
  // Refusals with no row to say whether they were expected count as not, as
  // determineBlockedOutcome fails closed on them.
  if (report.blocked.length === 0) unexpected = report.blockedCount;
  const failed = report.failed.reduce((total, row) => total + row.count, 0);
  const undecided = countUndecidedRequests(report);

  const items = [
    ...(unexpected ? [`🚫 ${unexpected} refused`] : []),
    ...extraItems,
    ...(failed ? [`⚠️ ${failed} failed`] : []),
    ...(undecided ? [`⚠️ ${undecided} not acted on`] : []),
  ];
  // Expected refusals need nothing done, so they lead only when nothing else does.
  if (expected) items.push(`${items.length ? "" : "✅ "}${expected} refused as expected`);
  return `**${items.length ? items.join(" · ") : "✅ Nothing was refused"}**\n\n`;
}

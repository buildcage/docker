import { countUndecidedRequests } from "../outcome/report-outcomes.ts";
import type { ReportData } from "../types.ts";

/**
 * Whether anything needs a look, counted as the annotations count it.
 * `extraItems`, an action's own checks, follow the refusals. An incomplete log
 * leads and rules out ✅, as it alone fails the step under restrict.
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
    ...(report.logLooksPlausible ? [] : ["❗ report incomplete"]),
    ...(unexpected ? [`🚫 ${unexpected} refused`] : []),
    ...extraItems,
    ...(failed ? [`⚠️ ${failed} failed`] : []),
    ...(undecided ? [`⚠️ ${undecided} not acted on`] : []),
  ];
  // Expected refusals need nothing done, so they lead only when nothing else does.
  if (expected) items.push(`${items.length ? "" : "✅ "}${expected} refused as expected`);
  return `**${items.length ? items.join(" · ") : "✅ Nothing was refused"}**\n\n`;
}

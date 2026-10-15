import { countUndecidedRequests } from "../outcome/report-outcomes.ts";
import type { ReportData } from "../types.ts";

/**
 * Whether anything needs a look, counted as the annotations count it: a GitHub
 * alert listing every count, CAUTION for an unexpected block or an
 * incomplete report and WARNING otherwise, or nothing when nothing does. The
 * counts carry no symbol, since the alert has its own icon. `extraItems`, an
 * action's own warnings, follow the blocks.
 */
export function renderVerdict(report: ReportData, extraItems: string[] = []): string {
  let unexpected = 0;
  let expected = 0;
  for (const row of report.blocked) {
    if (row.expected) expected += row.count;
    else unexpected += row.count;
  }
  // Blocks with no row to say whether they were expected count as not, as
  // determineBlockedOutcome fails closed on them.
  if (report.blocked.length === 0) unexpected = report.blockedCount;
  const failed = report.failed.reduce((total, row) => total + row.count, 0);
  const undecided = countUndecidedRequests(report);

  const caution = [
    ...(report.logLooksPlausible ? [] : ["report incomplete"]),
    ...(unexpected ? [`${unexpected} blocked`] : []),
  ];
  const warning = [
    ...extraItems,
    ...(failed ? [`${failed} failed`] : []),
    ...(undecided ? [`${undecided} not acted on`] : []),
  ];
  // Expected blocks need nothing done, so they never raise an alert alone.
  if (caution.length + warning.length === 0) return "";
  const items = [
    ...caution,
    ...warning,
    ...(expected ? [`${expected} blocked as expected`] : []),
  ].join(" · ");
  return `> [!${caution.length ? "CAUTION" : "WARNING"}]\n> ${items}\n\n`;
}

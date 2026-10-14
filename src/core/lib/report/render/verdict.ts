import { countUndecidedRequests } from "../outcome/report-outcomes.ts";
import type { ReportData } from "../types.ts";

/**
 * Whether anything needs a look, counted as the annotations count it: a GitHub
 * alert listing every count, CAUTION for an unexpected refusal or an
 * incomplete report and WARNING otherwise. The counts carry no symbol, since
 * the alert has its own icon. `extraItems`, an action's own warnings, follow
 * the refusals.
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

  const caution = [
    ...(report.logLooksPlausible ? [] : ["report incomplete"]),
    ...(unexpected ? [`${unexpected} refused`] : []),
  ];
  const warning = [
    ...extraItems,
    ...(failed ? [`${failed} failed`] : []),
    ...(undecided ? [`${undecided} not acted on`] : []),
  ];
  // Expected refusals need nothing done, so they lead only when nothing else does.
  const asExpected = expected ? [`${expected} refused as expected`] : [];
  if (caution.length + warning.length === 0) {
    return `Result: ✅ ${asExpected[0] ?? "Nothing was refused"}\n\n`;
  }
  const items = [...caution, ...warning, ...asExpected].join(" · ");
  return `> [!${caution.length ? "CAUTION" : "WARNING"}]\n> ${items}\n\n`;
}

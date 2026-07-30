/** Shared by both report-action.node.ts entry points; run/src/lib/report.ts
 *  calls determineBlockedOutcome/buildBlockedMessage directly instead,
 *  since it uses a different engineLabel and its own summary-writing. */
import { createAnnotation } from "../actions/annotation.ts";
import { determineBlockedOutcome, buildBlockedMessage } from "./known-blocked.ts";
import type { ReportDataCommon } from "./report-data.ts";

export interface EmitBlockedOutcomeOptions {
  failOnBlocked: boolean;
  summaryFile: string | undefined;
}

export function emitBlockedOutcome(
  report: ReportDataCommon,
  { failOnBlocked, summaryFile }: EmitBlockedOutcomeOptions,
): void {
  const isAudit = report.parameters.mode === "audit";
  const outcome = determineBlockedOutcome({
    isAudit,
    failOnBlocked,
    blockedCount: report.blockedCount,
    blockedRows: report.blocked,
    logLooksPlausible: report.logLooksPlausible,
  });

  if (outcome.level !== "none") {
    const message = buildBlockedMessage({
      blockedCount: report.blockedCount,
      blockedRows: report.blocked,
      engineLabel: "proxy",
      isAudit,
    });
    const annotation = createAnnotation(Boolean(summaryFile));
    if (outcome.level === "error") annotation.error(message);
    else annotation.notice(message);
  }

  if (outcome.shouldFail) process.exitCode = 1;
}

/** Emits an annotation and sets the exit code for a blocked-connection outcome. */
import { createAnnotation } from "../actions/annotation.ts";
import { describeBlockedOutcome } from "./known-blocked.ts";
import type { ReportDataCommon } from "./report-data.ts";

export interface EmitBlockedOutcomeOptions {
  failOnBlocked: boolean;
  summaryFile: string | undefined;
}

export function emitBlockedOutcome(
  report: ReportDataCommon,
  { failOnBlocked, summaryFile }: EmitBlockedOutcomeOptions,
): void {
  const { level, message, shouldFail } = describeBlockedOutcome({
    isAudit: report.parameters.mode === "audit",
    failOnBlocked,
    blockedCount: report.blockedCount,
    blockedRows: report.blocked,
    logLooksPlausible: report.logLooksPlausible,
    engineLabel: "proxy",
  });

  if (level !== "none") {
    const annotation = createAnnotation(Boolean(summaryFile));
    if (level === "error") annotation.error(message);
    else annotation.notice(message);
  }

  if (shouldFail) process.exitCode = 1;
}

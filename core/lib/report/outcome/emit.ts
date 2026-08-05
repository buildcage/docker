/** Emits an annotation and sets the exit code for a blocked-connection outcome. */
import { createAnnotation } from "../../actions/annotation.ts";
import { describeBlockedOutcome } from "./blocked-outcome.ts";
import { applyOutcomeAnnotation } from "./annotate.ts";
import type { ReportDataCommon } from "../types.ts";

export interface EmitBlockedOutcomeOptions {
  failOnBlocked: boolean;
  summaryFile: string | undefined;
}

export function emitBlockedOutcome(
  report: ReportDataCommon,
  { failOnBlocked, summaryFile }: EmitBlockedOutcomeOptions,
): void {
  const outcome = describeBlockedOutcome({
    isAudit: report.parameters.mode === "audit",
    failOnBlocked,
    blockedCount: report.blockedCount,
    blockedRows: report.blocked,
    logLooksPlausible: report.logLooksPlausible,
    engineLabel: "proxy",
  });

  applyOutcomeAnnotation(createAnnotation(Boolean(summaryFile)), outcome);
}

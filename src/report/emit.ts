import { createAnnotation } from "#core/lib/actions/annotation.ts";
import { describeReportOutcomes } from "#core/lib/report/outcome/report-outcomes.ts";
import { applyOutcomeAnnotations } from "#core/lib/report/outcome/annotate.ts";
import type { ReportData } from "#core/lib/report/types.ts";

export interface EmitReportOutcomesOptions {
  failOnBlocked: boolean;
  summaryFile: string | undefined;
}

export function emitReportOutcomes(
  report: ReportData,
  { failOnBlocked, summaryFile }: EmitReportOutcomesOptions,
): void {
  const outcomes = describeReportOutcomes(report, { failOnBlocked, engineLabel: "proxy" });

  applyOutcomeAnnotations(createAnnotation(Boolean(summaryFile)), outcomes);
}

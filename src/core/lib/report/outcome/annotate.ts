import type { Annotation } from "#core/lib/actions/annotation.ts";

export interface OutcomeEmission {
  level: "none" | "notice" | "warning" | "error";
  message: string;
  shouldFail: boolean;
}

/** Emits the annotations for a computed report outcome, in the order given, and
 *  sets the process exit code if any of them calls for failing the step. Shared
 *  by the report action's emitReportOutcomes and the run action's
 *  writeReportSummary, so a report's annotations are decided in one place for
 *  both. */
export function applyOutcomeAnnotations(
  annotation: Annotation,
  emissions: OutcomeEmission[],
): void {
  for (const { level, message, shouldFail } of emissions) {
    if (level === "error") annotation.error(message);
    else if (level === "warning") annotation.warning(message);
    else if (level === "notice") annotation.notice(message);
    if (shouldFail) process.exitCode = 1;
  }
}

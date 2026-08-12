import type { Annotation } from "#core/lib/actions/annotation.ts";

export interface OutcomeEmission {
  level: "none" | "notice" | "error";
  message: string;
  shouldFail: boolean;
}

/** Emits the annotation for a computed report outcome and sets the process
 *  exit code if it calls for failing the step. Shared by outcome/emit.ts
 *  (setup/report's proxy engines) and run's writeReportSummary. */
export function applyOutcomeAnnotation(
  annotation: Annotation,
  { level, message, shouldFail }: OutcomeEmission,
): void {
  if (level === "error") annotation.error(message);
  else if (level === "notice") annotation.notice(message);
  if (shouldFail) process.exitCode = 1;
}

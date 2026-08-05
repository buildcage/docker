import { scanHaproxyLog } from "#core/lib/log/haproxy.ts";
import { annotateKnownBlocked } from "./aggregate.ts";
import type { GenReportParameters, TransparentReportData } from "../types.ts";

/**
 * Pure — no I/O; callers (report-action.node.ts, run/src/lib/report.ts)
 * fetch lines/parameters themselves. An empty input naturally yields
 * passed:[]/blocked:[]/blockedCount:0, so no special-case branch is needed.
 */
export async function buildTransparentReportData(
  lines: AsyncIterable<string> | Iterable<string>,
  parameters: GenReportParameters,
): Promise<TransparentReportData> {
  const isAudit = parameters.mode === "audit";
  const {
    passed,
    blocked: blockedRawRows,
    blockedCount,
    hasNonBuildcageContent,
  } = await scanHaproxyLog(lines, isAudit);
  const blocked = annotateKnownBlocked(blockedRawRows, parameters.knownBlockedRules);

  return {
    engine: "transparent",
    parameters,
    passed,
    blocked,
    blockedCount,
    logLooksPlausible: hasNonBuildcageContent,
  };
}

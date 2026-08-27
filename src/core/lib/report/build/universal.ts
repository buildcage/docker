import { scanHaproxyLog } from "#core/lib/log/haproxy.ts";
import { annotateKnownBlocked } from "./aggregate.ts";
import type { GenReportParameters, UniversalReportData } from "../types.ts";

/**
 * Pure — no I/O; the caller (report-action.node.ts) fetches lines/parameters
 * itself. An empty input naturally yields passed:[]/blocked:[]/blockedCount:0,
 * so no special-case branch is needed.
 */
export async function buildUniversalReportData(
  lines: AsyncIterable<string> | Iterable<string>,
  parameters: GenReportParameters,
): Promise<UniversalReportData> {
  const isAudit = parameters.mode === "audit";
  const {
    passed,
    blocked: blockedRawRows,
    blockedCount,
    hasNonBuildcageContent,
  } = await scanHaproxyLog(lines, isAudit);
  const blocked = annotateKnownBlocked(blockedRawRows, parameters.knownBlockedRules);

  return {
    engine: "universal",
    parameters,
    passed,
    blocked,
    blockedCount,
    logLooksPlausible: hasNonBuildcageContent,
  };
}

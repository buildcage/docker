import { parseEntries, hasNonBuildcageContent } from "../log/haproxy-log-parser.ts";
import { aggregate } from "../log/aggregate.ts";
import { annotateKnownBlocked } from "./known-blocked.ts";
import type { GenReportParameters, TransparentReportData } from "./report-data.ts";

/**
 * Pure — no I/O; callers (report-action.node.ts, run/src/lib/report.ts)
 * fetch logText/parameters themselves. An empty logText naturally yields
 * passed:[]/blocked:[]/blockedCount:0, so no special-case branch is needed.
 */
export function buildTransparentReportData(logText: string, parameters: GenReportParameters): TransparentReportData {
  const isAudit = parameters.mode === "audit";
  const entries = parseEntries(logText);

  const blockedCount = entries.filter((e) => e.decision === "BLOCKED").length;
  const blockedRawRows = aggregate(entries.filter((e) => e.decision === "BLOCKED"));
  const blocked = annotateKnownBlocked(blockedRawRows, parameters.knownBlockedRules);

  const passed = isAudit
    ? aggregate(entries.filter((e) => e.decision === "AUDIT"))
    : aggregate(entries.filter((e) => e.decision === "ALLOWED"));

  return {
    engine: "transparent",
    parameters,
    passed,
    blocked,
    blockedCount,
    logLooksPlausible: hasNonBuildcageContent(logText),
  };
}

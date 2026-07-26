import { parseEntries } from "../log/haproxy-log-parser.ts";
import { aggregate } from "../log/aggregate.ts";
import { annotateKnownBlocked } from "./known-blocked.ts";
import type { GenReportParameters, TransparentReportData } from "./report-data.ts";

/**
 * Builds the transparent engine's report data from its own HAProxy log
 * text plus the container's configured parameters. Pure — no I/O; callers
 * (setup/docker/transparent/scripts/report-action.node.ts, run/src/lib/report.ts)
 * fetch logText/parameters themselves.
 *
 * No special-case branch for "no log entries at all" — an empty logText
 * naturally yields passed:[]/blocked:[]/blockedCount:0, which is already
 * how "nothing to report" is expressed.
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
  };
}

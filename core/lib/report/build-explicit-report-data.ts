import { parseEntries, parseDenialTimeline, hasNonDenialContent } from "../log/buildkitd-log-parser.ts";
import { aggregate } from "../log/aggregate.ts";
import { aggregateAllowedHosts, type VertexAllowedEntry } from "../log/vertex-log.ts";
import { annotateKnownBlocked } from "./known-blocked.ts";
import type { GenReportParameters, ExplicitReportData } from "./report-data.ts";

/**
 * Pure — no I/O; `builds` is already fetched via buildctl by the caller.
 * blockedCount equals blocked.length here, unlike the transparent engine:
 * buildkitd's denial log has no finer per-event granularity to count.
 */
export function buildExplicitReportData(
  logText: string,
  builds: VertexAllowedEntry[][],
  parameters: GenReportParameters,
): ExplicitReportData {
  const isAudit = parameters.mode === "audit";

  const blockedRawRows = aggregate(parseEntries(logText));
  const blockedCount = blockedRawRows.length;
  const blocked = annotateKnownBlocked(blockedRawRows, parameters.knownBlockedRules);

  const passed = aggregateAllowedHosts(builds, isAudit ? "AUDIT" : "ALLOWED");

  return {
    engine: "explicit",
    parameters,
    passed,
    blocked,
    blockedCount,
    logLooksPlausible: hasNonDenialContent(logText),
    proxyLogs: {
      builds,
      denied: parseDenialTimeline(logText),
    },
  };
}

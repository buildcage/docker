import { parseEntries, parseDenialTimeline } from "../log/buildkitd-log-parser.ts";
import { aggregate } from "../log/aggregate.ts";
import { aggregateAllowedHosts, type VertexAllowedEntry } from "../log/vertex-log.ts";
import { annotateKnownBlocked } from "./known-blocked.ts";
import type { GenReportParameters, ExplicitReportData } from "./report-data.ts";

/**
 * Builds the explicit engine's report data from its own buildkitd log text
 * plus the per-build allowed-request breakdown (already fetched via
 * buildctl debug histories/logs — see setup/docker/explicit/scripts/
 * report-action.node.ts) and the container's configured parameters. Pure —
 * no I/O.
 *
 * blockedCount here equals blocked.length (the aggregated row count) —
 * unlike the transparent engine, buildkitd's denial log has no finer
 * per-event granularity to count separately.
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
    proxyLogs: {
      builds,
      denied: parseDenialTimeline(logText),
    },
  };
}

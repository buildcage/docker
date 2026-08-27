import { scanBuildkitdLog } from "#core/lib/log/buildkitd.ts";
import { aggregateAllowedHosts, annotateKnownBlocked } from "./aggregate.ts";
import type { VertexAllowedEntry } from "#core/lib/log/vertex.ts";
import type { GenReportParameters, ExplicitReportData } from "../types.ts";

/** Pure — no I/O; callers fetch lines/builds/parameters themselves. */
export async function buildExplicitReportData(
  lines: AsyncIterable<string> | Iterable<string>,
  builds: VertexAllowedEntry[][],
  parameters: GenReportParameters,
): Promise<ExplicitReportData> {
  const isAudit = parameters.mode === "audit";
  const { blocked: blockedRawRows, denied, hasNonDenialContent } = await scanBuildkitdLog(lines);
  const blocked = annotateKnownBlocked(blockedRawRows, parameters.knownBlockedRules);
  // blockedCount equals blocked.length here, unlike the universal engine:
  // buildkitd's denial log has no finer per-event granularity to count.
  const blockedCount = blocked.length;

  const passed = aggregateAllowedHosts(builds, isAudit ? "AUDIT" : "ALLOWED");

  return {
    engine: "explicit",
    parameters,
    passed,
    blocked,
    blockedCount,
    logLooksPlausible: hasNonDenialContent,
    proxyLogs: {
      builds,
      denied,
    },
  };
}

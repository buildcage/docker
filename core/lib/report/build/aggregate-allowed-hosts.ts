import { parseIdentifier } from "../../log/parse-identifier.ts";
import { aggregate, type AggregatedEntry } from "../../log/aggregate.ts";
import type { AllowedRequest } from "../../log/proxy-request-text-parser.ts";

/**
 * Build the host-aggregated allowed/audited table from the same per-build
 * vertex data vertex-log-parser.ts's parseVertexAllowedLog() produces for
 * the per-command breakdown.
 *
 * decision is "ALLOWED" (restrict mode) or "AUDIT" (audit mode).
 */
export interface HasEntries {
  entries: AllowedRequest[];
}

export function aggregateAllowedHosts(builds: HasEntries[][], decision: string): AggregatedEntry[] {
  const entries = [];
  for (const vertices of builds) {
    for (const { entries: vertexEntries } of vertices) {
      for (const { url } of vertexEntries) {
        const parsed = parseIdentifier(url);
        if (!parsed) continue;
        entries.push({
          decision,
          ruleType: parsed.scheme === "https" ? "HTTPS" : "HTTP",
          host: parsed.host,
          port: parsed.port,
          reason: "-",
        });
      }
    }
  }
  return aggregate(entries);
}

import { compileRuleSet } from "#core/lib/acl/haproxy-rules.ts";
import { buildUrlRules } from "#core/lib/acl/url-rules.ts";
import { scanInspectLog, scanInspectDnsLog } from "#core/lib/log/inspect.ts";

import type { GenReportParameters, InspectReportData } from "../types.ts";
import { reduceTimeline } from "./aggregate.ts";

/** Whether the resolver allows a name, by the host regexes its Corefile is
 *  generated from. Case-insensitive, like the Corefile's `(?i)`. */
function resolverAllows(parameters: GenReportParameters): (name: string) => boolean {
  const { resolverHosts } = compileRuleSet({
    httpsRules: parameters.allowedHttpsRules,
    httpRules: parameters.allowedHttpRules,
    tlsRules: parameters.allowedTlsRules,
    urlRules: buildUrlRules(parameters.allowedUrlRules.join("\n")),
  });
  const allowed = resolverHosts.map((regex) => new RegExp(`^(?:${regex})$`, "i"));
  return (name) => allowed.some((regex) => regex.test(name));
}

/**
 * Build the report data from the proxy and resolver logs. Pure: the caller
 * fetches both logs, the parameters and the proxy's dropped-line count
 * (undefined where it could not be read).
 *
 * The resolver log matters because a refused name never reached the proxy, so
 * a DNS-only exfiltration attempt would otherwise leave no trace.
 */
export async function buildInspectReportData(
  proxyLines: AsyncIterable<string> | Iterable<string>,
  dnsLines: AsyncIterable<string> | Iterable<string>,
  parameters: GenReportParameters,
  droppedLogs: number | undefined,
): Promise<InspectReportData> {
  const isAudit = parameters.mode === "audit";
  // Independent inputs (separate `docker exec` log streams, no data
  // dependency between them), so read concurrently rather than paying their
  // combined latency serially.
  const [
    { events: proxyEvents, startedAt, headIntact: proxyHeadIntact, unparsed },
    { events: dnsEvents, headIntact: dnsHeadIntact, unparsed: dnsUnparsed },
  ] = await Promise.all([
    // audit's resolver allows every name.
    scanInspectLog(proxyLines, isAudit, isAudit ? undefined : resolverAllows(parameters)),
    scanInspectDnsLog(dnsLines, isAudit),
  ]);

  const timeline = [...proxyEvents, ...dnsEvents].sort((a, b) => a.time - b.time);

  return {
    engine: "inspect",
    parameters,
    ...reduceTimeline(timeline, parameters.knownBlockedRules),
    // Either log losing its beginning loses evidence the other cannot vouch
    // for, and an unreadable or dropped line is the same gap mid-log.
    logLooksPlausible:
      proxyHeadIntact && dnsHeadIntact && unparsed === 0 && dnsUnparsed === 0 && droppedLogs === 0,
    startedAt,
    timeline,
  };
}

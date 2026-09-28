import { scanHaproxyLog } from "#core/lib/log/haproxy.ts";
import { scanInspectDnsLog } from "#core/lib/log/inspect.ts";

import type { GenReportParameters, UniversalReportData } from "../types.ts";
import { reduceTimeline } from "./aggregate.ts";

/**
 * Build the report data from the proxy and resolver logs. Pure: the caller
 * fetches both logs, the parameters and the proxy's dropped-line count
 * (undefined where it could not be read).
 *
 * universal never terminates TLS, so its proxy events carry no method, URL or
 * status, only the host, port and bytes of each connection. The resolver log is
 * read because a name looked up but never connected to reaches no HAProxy line,
 * so a DNS-only refusal would otherwise leave no trace.
 */
export async function buildUniversalReportData(
  proxyLines: AsyncIterable<string> | Iterable<string>,
  dnsLines: AsyncIterable<string> | Iterable<string>,
  parameters: GenReportParameters,
  droppedLogs: number | undefined,
): Promise<UniversalReportData> {
  const isAudit = parameters.mode === "audit";
  // Independent inputs (separate log streams, no data dependency), so read
  // concurrently rather than paying their combined latency serially.
  const [
    { events: proxyEvents, startedAt, headIntact: proxyHeadIntact, unparsed },
    { events: dnsEvents, headIntact: dnsHeadIntact, unparsed: dnsUnparsed },
  ] = await Promise.all([
    scanHaproxyLog(proxyLines, isAudit),
    scanInspectDnsLog(dnsLines, isAudit),
  ]);

  const timeline = [...proxyEvents, ...dnsEvents].sort((a, b) => a.time - b.time);

  return {
    engine: "universal",
    parameters,
    ...reduceTimeline(timeline, parameters.knownBlockedRules),
    // A decision line this cannot read, or one the proxy dropped, may well have
    // been a refusal, and either log losing its beginning loses evidence the
    // other cannot vouch for.
    logLooksPlausible:
      proxyHeadIntact && dnsHeadIntact && unparsed === 0 && dnsUnparsed === 0 && droppedLogs === 0,
    startedAt,
    timeline,
  };
}

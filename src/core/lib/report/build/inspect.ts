import { scanInspectLog, scanInspectDnsLog } from "#core/lib/log/inspect.ts";
import { isRedundantBlockedDns, type TrafficEvent } from "#core/lib/log/traffic-event.ts";
import { aggregate, type LogEntry } from "#core/lib/log/aggregate.ts";
import { annotateKnownBlocked } from "./aggregate.ts";
import type { GenReportParameters, InspectReportData } from "../types.ts";

/** How a protocol appears in the host tables, matching the rule kind that
 *  would permit it. */
const RULE_TYPE: Record<TrafficEvent["protocol"], string> = {
  https: "HTTPS",
  http: "HTTP",
  tls: "TLS",
  tcp: "IP",
  dns: "DNS",
};

/** Reduce an event to the host row a rule is written against. A dns event has
 *  no port, having connected to nothing. */
function toHostRow(event: TrafficEvent): LogEntry {
  return {
    host: event.host,
    port: event.port === undefined ? "-" : String(event.port),
    ruleType: RULE_TYPE[event.protocol],
    reason: event.reason ?? "-",
  };
}

/**
 * Build the report data from the proxy and resolver logs. Pure -- the caller
 * fetches both logs and the parameters.
 *
 * The resolver log matters because a refused name never reached the proxy, so
 * a DNS-only exfiltration attempt would otherwise leave no trace. Everything
 * lands in one time-ordered timeline: no event can be attributed to a RUN step,
 * unlike the explicit engine.
 */
export async function buildInspectReportData(
  proxyLines: AsyncIterable<string> | Iterable<string>,
  dnsLines: AsyncIterable<string> | Iterable<string>,
  parameters: GenReportParameters,
): Promise<InspectReportData> {
  const isAudit = parameters.mode === "audit";
  const { events: proxyEvents, startedAt } = await scanInspectLog(proxyLines, isAudit);
  const dnsEvents = await scanInspectDnsLog(dnsLines, isAudit);

  const timeline = [...proxyEvents, ...dnsEvents].sort((a, b) => a.time - b.time);

  const passedRows: LogEntry[] = [];
  const blockedRows: LogEntry[] = [];
  for (const event of timeline) {
    // A name that merely resolved is not traffic; the request that followed it
    // is already in the table, and listing both would double every row. The
    // same holds for a blocked name once a blocked request for it also
    // appears.
    if (event.protocol === "dns" && event.action !== "block") continue;
    if (isRedundantBlockedDns(event, timeline)) continue;
    (event.action === "block" ? blockedRows : passedRows).push(toHostRow(event));
  }

  const blocked = annotateKnownBlocked(aggregate(blockedRows), parameters.knownBlockedRules);

  return {
    engine: "inspect",
    parameters,
    passed: aggregate(passedRows),
    blocked,
    // Every blocked event is counted, not just the distinct hosts the table
    // collapses them into.
    blockedCount: blockedRows.length,
    logLooksPlausible: startedAt !== undefined,
    startedAt,
    timeline,
  };
}

import { scanHaproxyLog } from "#core/lib/log/haproxy.ts";
import { scanInspectDnsLog } from "#core/lib/log/inspect.ts";

import type { GenReportParameters, UniversalReportData } from "../types.ts";
import { assembleReportData } from "./aggregate.ts";

/**
 * Build the report data from the proxy and resolver logs. Pure: the caller
 * fetches both logs, the parameters and the proxy's dropped-line count
 * (undefined where it could not be read).
 *
 * universal never terminates TLS, so its proxy events carry no method, URL or
 * status, only the host, port and bytes of each connection. The resolver log is
 * read because a name looked up but never connected to reaches no HAProxy line,
 * so a DNS-only block would otherwise leave no trace.
 */
export async function buildUniversalReportData(
  proxyLines: AsyncIterable<string> | Iterable<string>,
  dnsLines: AsyncIterable<string> | Iterable<string>,
  parameters: GenReportParameters,
  droppedLogs: number | undefined,
): Promise<UniversalReportData> {
  const isAudit = parameters.mode === "audit";
  // Independent inputs (separate log streams, no data dependency), so start
  // both scans and let assembleReportData read them concurrently.
  return assembleReportData(
    "universal",
    scanHaproxyLog(proxyLines, isAudit),
    scanInspectDnsLog(dnsLines, isAudit),
    parameters,
    droppedLogs,
  );
}

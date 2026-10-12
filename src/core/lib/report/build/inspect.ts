import { compileRuleSet } from "#core/lib/acl/haproxy-rules.ts";
import { buildUrlRules } from "#core/lib/acl/url-rules.ts";
import { scanInspectLog, scanInspectDnsLog } from "#core/lib/log/inspect.ts";

import type { GenReportParameters, InspectReportData } from "../types.ts";
import { assembleReportData } from "./aggregate.ts";

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
  // Independent inputs (separate `docker exec` log streams, no data dependency
  // between them), so start both scans and let assembleReportData read them
  // concurrently. audit's resolver allows every name.
  return assembleReportData(
    "inspect",
    scanInspectLog(proxyLines, isAudit, isAudit ? undefined : resolverAllows(parameters)),
    scanInspectDnsLog(dnsLines, isAudit),
    parameters,
    droppedLogs,
  );
}

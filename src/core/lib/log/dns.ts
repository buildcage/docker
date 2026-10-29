/**
 * Parser for the resolver log every engine shares, whose format is emitted by
 * coredns-config.ts. Four kinds of line:
 *
 *   <timestamp>  [INFO] buildcage dns <allowed|denied> name=<name>.
 *   <timestamp>  [INFO] buildcage dns discovery name=<name>. type=<qtype>
 *   <timestamp>  [INFO] buildcage dns service-denied name=<name>. type=<qtype>
 *   <timestamp>  buildcage coredns starting
 *
 * `buildcage dns reverse name=<name>.` is deliberately not on that list: no
 * rule can name a reverse zone, so an event for it would be a report row no
 * rule could ever take away. It stays in the resolver log alone.
 *
 * The dns line is the only record of a blocked name, which never reaches the
 * proxy.
 */

import { actionFor, type TrafficEvent } from "./traffic-event.ts";

// CoreDNS escapes a space in a label as `\ `. Names stay escaped, as the
// Corefile and known-blocked-rules match that same text.
const DNS_NAME = String.raw`((?:[^\s\\]|\\.)+?)`;
const DNS = new RegExp(
  String.raw`^(\S+ \S+)\s+.*buildcage dns (allowed|denied) name=${DNS_NAME}\.?$`,
);
// A `_service._proto.<host>` name is answered NODATA whatever the rules say,
// so no rule decided it.
const DNS_DISCOVERY = new RegExp(
  String.raw`^(\S+ \S+)\s+.*buildcage dns discovery name=${DNS_NAME}\.? type=(\S+)$`,
);
// Kept apart from a plain denial so the report can name the host below the
// name as the remedy. Only the Corefile decides which names are service names.
const DNS_SERVICE_DENIED = new RegExp(
  String.raw`^(\S+ \S+)\s+.*buildcage dns service-denied name=${DNS_NAME}\.? type=(\S+)$`,
);
/** Any line of ours but a reverse lookup, which never becomes an event. */
const DNS_LINE = /^\S+ \S+\s+.*buildcage dns (?!reverse )/;
/** Echoed before CoreDNS starts, so it is always the log's first line (see
 *  docker/common/files/s6-rc.d/coredns/run). s6-log stamps this log, hence
 *  the suffix test. */
const DNS_START_MARKER = "buildcage coredns starting";

/** The resolver log's timestamp, in seconds since the epoch. */
function timeOf(stamp: string): number {
  const parsed = Date.parse(`${stamp.replace(" ", "T")}Z`);
  return Number.isNaN(parsed) ? 0 : parsed / 1000;
}

/** What one pass over the resolver log yields. */
export interface DnsLogScan {
  events: TrafficEvent[];
  /** True iff the log's first non-blank line is the startup marker. See
   *  scanDnsLog. */
  headIntact: boolean;
  /** Lines written for one of our rules yet matching no format above. Each
   *  may be a block the report cannot account for. */
  unparsed: number;
}

/**
 * Parse the resolver log into one event per name.
 *
 * A name is asked about repeatedly, and for A and AAAA separately, so only the
 * first mention of each is kept: the report is about which names a build
 * reached for, not how many times a resolver was consulted. An allowed answer
 * is decisive, so an AAAA block cannot mask an A that resolved.
 *
 * A discovery lookup is kept per name and type: the same name asked as SRV and
 * as TXT are two different things. A blocked service name is kept per name
 * like any other block, carrying the first type it was asked as.
 *
 * The time comes from s6-log rather than from CoreDNS, whose log plugin has no
 * timestamp replacement of its own. CoreDNS lowercases the name it logs, so a
 * name that carried information in its capitalisation is recorded without it.
 *
 * `headIntact` is false when the log doesn't open with the startup marker,
 * meaning its beginning is gone and the earliest blocked names with it. Only
 * the marker counts: CoreDNS's `errors` plugin writes mid-run.
 */
export async function scanDnsLog(
  lines: AsyncIterable<string> | Iterable<string>,
  isAudit = false,
): Promise<DnsLogScan> {
  const seen = new Map<string, { time: number; allowed: boolean }>();
  const discovery = new Map<string, { time: number; host: string; queryType: string }>();
  const service = new Map<string, { time: number; host: string; queryType: string }>();
  let headIntact: boolean | undefined;
  let unparsed = 0;
  for await (const line of lines) {
    const trimmed = line.trim();
    if (trimmed !== "") headIntact ??= trimmed.endsWith(DNS_START_MARKER);
    const match = DNS.exec(trimmed);
    if (match) {
      const time = timeOf(match[1]);
      const allowed = match[2] === "allowed";
      const existing = seen.get(match[3]);
      if (existing) existing.allowed ||= allowed;
      else seen.set(match[3], { time, allowed });
      continue;
    }
    const lookup = DNS_DISCOVERY.exec(trimmed);
    if (lookup) {
      const key = `${lookup[2]}\t${lookup[3]}`;
      if (!discovery.has(key)) {
        discovery.set(key, { time: timeOf(lookup[1]), host: lookup[2], queryType: lookup[3] });
      }
      continue;
    }
    const blockedService = DNS_SERVICE_DENIED.exec(trimmed);
    if (!blockedService) {
      if (DNS_LINE.test(trimmed)) unparsed++;
      continue;
    }
    if (!service.has(blockedService[2])) {
      service.set(blockedService[2], {
        time: timeOf(blockedService[1]),
        host: blockedService[2],
        queryType: blockedService[3],
      });
    }
  }
  const events = [...seen.entries()].map(([host, { time, allowed }]) => {
    const reason = allowed ? undefined : "dns-not-allowed";
    const event: TrafficEvent = {
      time,
      action: actionFor(reason, isAudit),
      protocol: "dns",
      host,
    };
    if (reason !== undefined) event.reason = reason;
    return event;
  });
  for (const { time, host, queryType } of discovery.values()) {
    events.push({ time, action: "discovery", protocol: "dns", host, queryType });
  }
  for (const { time, host, queryType } of service.values()) {
    events.push({
      time,
      action: actionFor("dns-service-not-allowed", isAudit),
      protocol: "dns",
      host,
      queryType,
      reason: "dns-service-not-allowed",
    });
  }
  return { events, headIntact: headIntact ?? false, unparsed };
}

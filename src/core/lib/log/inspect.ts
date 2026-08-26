/**
 * Parsers for the `inspect` engine's two logs, whose formats are emitted by
 * haproxy-config.ts and coredns-config.ts. Four kinds of line:
 *
 *   buildcage <ms> <https|http> <method> <url> <status> <bytes> ts=<st> dst=<addr>:<port>
 *   buildcage <ms> pass <tls|tcp> sni=<name|-> <bytes> ts=<st> dst=<addr>:<port>
 *   <timestamp>  [INFO] buildcage dns <allowed|denied> name=<name>.
 *   buildcage haproxy starting <ms>
 *
 * <ms> is milliseconds since the epoch (HAProxy's date(0,ms), or qjs's
 * Date.now() for the startup line, printed before HAProxy itself is even
 * running); TrafficEvent's own time is in seconds, so parsing divides it
 * back down.
 *
 * The passthrough line is the only record of undecrypted traffic; the dns line
 * the only record of a refused name, which never reaches the proxy. Any other
 * line is HAProxy's or CoreDNS's own output and is skipped.
 */

import type { TrafficAction, TrafficEvent } from "./traffic-event.ts";

export type { TrafficAction, TrafficEvent, TrafficProtocol } from "./traffic-event.ts";

const REQUEST = /^buildcage (\d+) (https?) (\S+) (\S+) (-?\d+) (\d+) ts=(\S*) dst=(\S+):(\d+)$/;
const PASSTHROUGH = /^buildcage (\d+) pass (tls|tcp) sni=(\S+) (\d+) ts=(\S*) dst=(\S+):(\d+)$/;
const DNS = /^(\S+ \S+)\s+.*buildcage dns (allowed|denied) name=(\S+?)\.?$/;

/** The marker the proxy prints once at startup. See hasProxyStarted. */
const START_MARKER = "buildcage haproxy starting";
/** Same marker, capturing the millisecond epoch it was printed with. */
const START = /^buildcage haproxy starting (\d+)$/;

/**
 * Whether buildcage ended the exchange, rather than an origin answering.
 *
 * The status cannot say: an origin answers 403 or 503 of its own accord too.
 * HAProxy's termination state can: `P` for a deny/reject, `S` for a backend
 * unreachable or unverified, `-` for a relayed response.
 */
function isRefusal(terminationState: string): boolean {
  return terminationState.startsWith("P") || terminationState.startsWith("S");
}

/** Refusal reason, matching the transparent engine's kebab-case vocabulary. */
function reasonForStatus(status: number): string {
  if (status === 502) return "dns-failed";
  if (status === 503) return "origin-unreachable";
  return "not-allowed";
}

function actionFor(refused: boolean, isAudit: boolean): TrafficAction {
  if (refused) return "block";
  // audit enforces nothing, so nothing here was allowed by a rule. Calling it
  // "allow" would claim a decision that was never made.
  return isAudit ? "audit" : "allow";
}

const URL_AUTHORITY = /^https?:\/\/([^/?#]+)/;

/** The host half of an absolute URL's authority, without its port. */
function hostOf(url: string): string {
  const match = URL_AUTHORITY.exec(url);
  if (!match) return url;
  const authority = match[1];
  const colon = authority.lastIndexOf(":");
  return colon > 0 ? authority.slice(0, colon) : authority;
}

/** Parse one proxy-log line, or null if it is not one of ours. */
function parseProxyLine(line: string, isAudit: boolean): TrafficEvent | null {
  const trimmed = line.trim();

  const request = REQUEST.exec(trimmed);
  if (request) {
    const refused = isRefusal(request[7]);
    const event: TrafficEvent = {
      time: Number(request[1]) / 1000,
      action: actionFor(refused, isAudit),
      protocol: request[2] as "http" | "https",
      host: hostOf(request[4]),
      port: Number(request[9]),
      method: request[3],
      url: request[4],
      destination: `${request[8]}:${request[9]}`,
    };
    if (refused) event.reason = reasonForStatus(Number(request[5]));
    else {
      event.status = Number(request[5]);
      event.bytes = Number(request[6]);
    }
    return event;
  }

  const pass = PASSTHROUGH.exec(trimmed);
  if (pass) {
    const refused = isRefusal(pass[5]);
    // An ip rule names an address and carries no SNI, so the address is the
    // only identity such a connection has.
    const sni = pass[3];
    const event: TrafficEvent = {
      time: Number(pass[1]) / 1000,
      action: actionFor(refused, isAudit),
      protocol: pass[2] as "tls" | "tcp",
      host: sni === "-" ? pass[6] : sni,
      port: Number(pass[7]),
      destination: `${pass[6]}:${pass[7]}`,
    };
    // Never decrypted, so there is no status to report either way.
    if (refused) event.reason = "not-allowed";
    else event.bytes = Number(pass[4]);
    return event;
  }

  return null;
}

/** What one pass over the proxy log yields. */
export interface InspectLogScan {
  events: TrafficEvent[];
  /** Seconds since the epoch the proxy itself started, matching
   *  TrafficEvent.time's unit. Undefined exactly when hasProxyStarted would
   *  be false -- the marker line never showed up at all. */
  startedAt: number | undefined;
}

/**
 * Read the proxy log once, collecting both the events and the startup marker.
 *
 * The report needs both, and the log arrives as a stream that can only be
 * consumed once, so they cannot be two separate passes. `for await` also
 * accepts a plain array, so callers with the lines already in memory pass one.
 */
export async function scanInspectLog(
  lines: AsyncIterable<string> | Iterable<string>,
  isAudit = false,
): Promise<InspectLogScan> {
  const events: TrafficEvent[] = [];
  let startedAt: number | undefined;
  for await (const line of lines) {
    const event = parseProxyLine(line, isAudit);
    if (event) {
      events.push(event);
      continue;
    }
    if (startedAt === undefined) {
      const match = START.exec(line.trim());
      if (match) startedAt = Number(match[1]) / 1000;
    }
  }
  return { events, startedAt };
}

/**
 * True when the log carries the marker the proxy prints once at startup.
 *
 * An empty log is ambiguous: the proxy may have started and seen nothing, or it
 * may never have started at all. The caller fails closed rather than reporting
 * "nothing was blocked" for a proxy that never ran.
 */
export function hasProxyStarted(lines: Iterable<string>): boolean {
  for (const line of lines) {
    if (line.includes(START_MARKER)) return true;
  }
  return false;
}

/**
 * Parse the resolver log into one event per name.
 *
 * A name is asked about repeatedly, and for A and AAAA separately, so only the
 * first mention of each is kept: the report is about which names a build
 * reached for, not how many times a resolver was consulted. An allowed answer
 * is decisive, so an AAAA refusal cannot mask an A that resolved.
 *
 * The time comes from s6-log rather than from CoreDNS, whose log plugin has no
 * timestamp replacement of its own. CoreDNS lowercases the name it logs, so a
 * name that carried information in its capitalisation is recorded without it.
 */
export async function scanInspectDnsLog(
  lines: AsyncIterable<string> | Iterable<string>,
  isAudit = false,
): Promise<TrafficEvent[]> {
  const seen = new Map<string, { time: number; allowed: boolean }>();
  for await (const line of lines) {
    const match = DNS.exec(line.trim());
    if (!match) continue;
    const parsed = Date.parse(`${match[1].replace(" ", "T")}Z`);
    const time = Number.isNaN(parsed) ? 0 : parsed / 1000;
    const allowed = match[2] === "allowed";
    const existing = seen.get(match[3]);
    if (existing) existing.allowed ||= allowed;
    else seen.set(match[3], { time, allowed });
  }
  return [...seen.entries()].map(([host, { time, allowed }]) => {
    const event: TrafficEvent = {
      time,
      action: actionFor(!allowed, isAudit),
      protocol: "dns",
      host,
    };
    if (!allowed) event.reason = "dns-not-allowed";
    return event;
  });
}

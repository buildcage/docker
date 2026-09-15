/**
 * Parsers for the `inspect` engine's two logs, whose formats are emitted by
 * haproxy-config.ts and coredns-config.ts. Four kinds of line:
 *
 *   buildcage <ms> <https|http> <method> <status> <bytes> ts=<st> reason=<r> dst=<addr>:<port> <url>
 *   buildcage <ms> pass <tls|tcp> <bytes> ts=<st> reason=<r> dst=<addr>:<port> sni=<name|->
 *   <timestamp>  [INFO] buildcage dns <allowed|denied> name=<name>.
 *   <timestamp>  [INFO] buildcage dns discovery name=<name>. type=<qtype>
 *   <timestamp>  [INFO] buildcage dns service-denied name=<name>. type=<qtype>
 *   buildcage haproxy starting <ms>
 *
 * The discovery line is a lookup no rule decided: a `_service._proto.<host>`
 * name is answered NODATA whatever the rules say. It becomes an event, never
 * an allowed or blocked one.
 *
 * The service-denied line is a refusal like any other, kept apart so the report
 * can name the remedy: the host below the name, never the name itself. Which
 * names are service names is decided in the Corefile alone, so nothing here
 * recognises the shape.
 *
 * A fifth, `buildcage dns reverse name=<name>.`, is deliberately none of them:
 * no rule can name a reverse zone, so an event for it would be a report row no
 * rule could ever take away. It stays in the resolver log alone.
 *
 * <ms> is milliseconds since the epoch (HAProxy's date(0,ms), or qjs's
 * Date.now() for the startup line, printed before HAProxy itself is even
 * running); TrafficEvent's own time is in seconds, so parsing divides it
 * back down.
 *
 * The passthrough line is the only record of undecrypted traffic; the dns line
 * the only record of a refused name, which never reaches the proxy. Any other
 * line is HAProxy's or CoreDNS's own output and is skipped.
 *
 * The URL and the SNI are last because the build chooses their length: a cut
 * line costs their tail, not the decision. Nothing should cut one, since both
 * the configured line length and s6-log's split are above the longest request
 * haproxy accepts, so `unparsed` counts what arrives unreadable anyway rather
 * than skipping it. A line the log pipe dropped whole leaves no trace at all.
 */

import type { TrafficAction, TrafficEvent } from "./traffic-event.ts";

export type { TrafficAction, TrafficEvent, TrafficProtocol } from "./traffic-event.ts";

// The trailing field stays \S+ rather than .+: two lines joined by a
// half-written write would otherwise parse as one event instead of counting.
const REQUEST =
  /^buildcage (\d+) (https?) (\S+) (-?\d+) (\d+) ts=(\S*) reason=(\S+) dst=(\S+):(\d+) (\S+)$/;
const PASSTHROUGH =
  /^buildcage (\d+) pass (tls|tcp) (\d+) ts=(\S*) reason=(\S+) dst=(\S+):(\d+) sni=(\S+)$/;
const DNS = /^(\S+ \S+)\s+.*buildcage dns (allowed|denied) name=(\S+?)\.?$/;
const DNS_DISCOVERY = /^(\S+ \S+)\s+.*buildcage dns discovery name=(\S+?)\.? type=(\S+)$/;
const DNS_SERVICE_DENIED = /^(\S+ \S+)\s+.*buildcage dns service-denied name=(\S+?)\.? type=(\S+)$/;
/** Echoed before CoreDNS starts, so it is always the log's first line (see
 *  inspect/files/s6-rc.d/coredns/run). s6-log stamps this log, hence the
 *  suffix test. */
const DNS_START_MARKER = "buildcage coredns starting";

/** What every line the proxy writes for us opens with. HAProxy's own
 *  [NOTICE]/[WARNING] output never does. */
const LINE_PREFIX = "buildcage ";

/** The marker the proxy prints once at startup. See hasProxyStarted. */
const START_MARKER = "buildcage haproxy starting";
/** Same marker, capturing the millisecond epoch it was printed with. */
const START = /^buildcage haproxy starting (\d+)$/;

/** The resolver log's timestamp, in seconds since the epoch. */
function timeOf(stamp: string): number {
  const parsed = Date.parse(`${stamp.replace(" ", "T")}Z`);
  return Number.isNaN(parsed) ? 0 : parsed / 1000;
}

/**
 * Whether the response the build saw was buildcage's own, not an origin's.
 *
 * The status cannot say: an origin answers 403 or 503 of its own accord too.
 * HAProxy's termination state can: `P` for a deny/reject, `S` for a backend
 * unreachable or unverified, `s` for the same reached by timing out instead,
 * `-` for a relayed response. A client-side timeout (`c`) is the build
 * dropping its own connection, which the proxy never stood in the way of.
 */
function isRefusal(terminationState: string): boolean {
  const cause = terminationState[0];
  return cause === "P" || cause === "S" || cause === "s";
}

/**
 * Refusal reason, matching the universal engine's kebab-case vocabulary.
 *
 * The config names the refusals only it can tell apart: 502 is both our DNS
 * deny and an origin that gave up, and a passthrough reject has no status at
 * all. Everything else the phase already names, so the field stays `-`.
 */
function reasonFor(logged: string, terminationState: string): string {
  if (logged !== "-") return logged;
  switch (terminationState[1]) {
    case "R":
      return "not-allowed";
    case "C":
      return "origin-unreachable";
    case "H":
      return "origin-no-response";
    case "D":
    case "L":
      return "origin-aborted";
    default:
      return "not-allowed";
  }
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
    const refused = isRefusal(request[6]);
    const event: TrafficEvent = {
      time: Number(request[1]) / 1000,
      action: actionFor(refused, isAudit),
      protocol: request[2] as "http" | "https",
      host: hostOf(request[10]),
      port: Number(request[9]),
      method: request[3],
      url: request[10],
      destination: `${request[8]}:${request[9]}`,
    };
    if (refused) event.reason = reasonFor(request[7], request[6]);
    else {
      event.status = Number(request[4]);
      event.bytes = Number(request[5]);
    }
    return event;
  }

  const pass = PASSTHROUGH.exec(trimmed);
  if (pass) {
    const refused = isRefusal(pass[4]);
    // An ip rule names an address and carries no SNI, so the address is the
    // only identity such a connection has.
    const sni = pass[8];
    const event: TrafficEvent = {
      time: Number(pass[1]) / 1000,
      action: actionFor(refused, isAudit),
      protocol: pass[2] as "tls" | "tcp",
      host: sni === "-" ? pass[6] : sni,
      port: Number(pass[7]),
      destination: `${pass[6]}:${pass[7]}`,
    };
    // Never decrypted, so there is no status to report either way.
    if (refused) event.reason = reasonFor(pass[5], pass[4]);
    else event.bytes = Number(pass[3]);
    return event;
  }

  return null;
}

/** What one pass over the resolver log yields. */
export interface InspectDnsLogScan {
  events: TrafficEvent[];
  /** True iff the log's first non-blank line is the startup marker. See
   *  scanInspectDnsLog. */
  headIntact: boolean;
}

/** What one pass over the proxy log yields. */
export interface InspectLogScan {
  events: TrafficEvent[];
  /** Seconds since the epoch the proxy itself started, matching
   *  TrafficEvent.time's unit. Undefined exactly when hasProxyStarted would
   *  be false -- the marker line never showed up at all. */
  startedAt: number | undefined;
  /** True iff the log opens with the startup marker. Stricter than
   *  `startedAt`: a restart writes a second marker, which would otherwise
   *  vouch for a beginning that had already rotated away. */
  headIntact: boolean;
  /** Lines that open as the proxy's own yet match no format above. Each is an
   *  event the report cannot account for. */
  unparsed: number;
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
  let headIntact: boolean | undefined;
  let unparsed = 0;
  for await (const line of lines) {
    const event = parseProxyLine(line, isAudit);
    if (event) {
      headIntact ??= false;
      events.push(event);
      continue;
    }
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const match = START.exec(trimmed);
    headIntact ??= match !== null;
    if (match && startedAt === undefined) startedAt = Number(match[1]) / 1000;
    // Excluded by prefix rather than by `match`: a qjs that failed to print
    // the stamp would leave the marker bare, which is not a missing event.
    if (trimmed.startsWith(LINE_PREFIX) && !trimmed.startsWith(START_MARKER)) unparsed++;
  }
  return { events, startedAt, headIntact: headIntact ?? false, unparsed };
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
 * A discovery lookup is kept per name and type: the same name asked as SRV and
 * as TXT are two different things. A refused service name is kept per name
 * like any other refusal, carrying the first type it was asked as.
 *
 * The time comes from s6-log rather than from CoreDNS, whose log plugin has no
 * timestamp replacement of its own. CoreDNS lowercases the name it logs, so a
 * name that carried information in its capitalisation is recorded without it.
 *
 * `headIntact` is false when the log doesn't open with the startup marker,
 * meaning its beginning is gone and the earliest refused names with it. Only
 * the marker counts: CoreDNS's `errors` plugin writes mid-run.
 */
export async function scanInspectDnsLog(
  lines: AsyncIterable<string> | Iterable<string>,
  isAudit = false,
): Promise<InspectDnsLogScan> {
  const seen = new Map<string, { time: number; allowed: boolean }>();
  const discovery = new Map<string, { time: number; host: string; queryType: string }>();
  const service = new Map<string, { time: number; host: string; queryType: string }>();
  let headIntact: boolean | undefined;
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
    const refused = DNS_SERVICE_DENIED.exec(trimmed);
    if (!refused) continue;
    if (!service.has(refused[2])) {
      service.set(refused[2], {
        time: timeOf(refused[1]),
        host: refused[2],
        queryType: refused[3],
      });
    }
  }
  const events = [...seen.entries()].map(([host, { time, allowed }]) => {
    const event: TrafficEvent = {
      time,
      action: actionFor(!allowed, isAudit),
      protocol: "dns",
      host,
    };
    if (!allowed) event.reason = "dns-not-allowed";
    return event;
  });
  for (const { time, host, queryType } of discovery.values()) {
    events.push({ time, action: "discovery", protocol: "dns", host, queryType });
  }
  for (const { time, host, queryType } of service.values()) {
    events.push({
      time,
      action: actionFor(true, isAudit),
      protocol: "dns",
      host,
      queryType,
      reason: "dns-service-not-allowed",
    });
  }
  return { events, headIntact: headIntact ?? false };
}

/**
 * Parsers for the `inspect` engine's two logs, whose formats are emitted by
 * haproxy-config.ts and coredns-config.ts. Seven kinds of line:
 *
 *   buildcage <ms> https <method> <status> <bytes> ts=<st> reason=<r> tlserr=<n|-> dst=<addr>:<port> fcerr=<name|-> sni=<name|-> host=<authority|-> <target|->
 *   buildcage <ms> http <method> <status> <bytes> ts=<st> reason=<r> tlserr=<n|-> dst=<addr>:<port> host=<authority|-> <target|->
 *   buildcage <ms> pass <tls|tcp> <bytes> ts=<st> reason=<r> dst=<addr>:<port> sni=<name|->
 *   <timestamp>  [INFO] buildcage dns <allowed|denied> name=<name>.
 *   <timestamp>  [INFO] buildcage dns discovery name=<name>. type=<qtype>
 *   <timestamp>  [INFO] buildcage dns service-denied name=<name>. type=<qtype>
 *   buildcage haproxy starting <ms>
 *
 * `buildcage dns reverse name=<name>.` is deliberately not on that list: no
 * rule can name a reverse zone, so an event for it would be a report row no
 * rule could ever take away. It stays in the resolver log alone.
 *
 * The passthrough line is the only record of undecrypted traffic; the dns line
 * the only record of a refused name, which never reaches the proxy. Only the
 * https line carries an SNI, since only that stage terminates TLS. A client
 * handshake that failed writes that line too, with fcerr naming the failure.
 */

import { DEFAULT_PORT } from "#core/lib/acl/url-rules.ts";

import { ruleHost, sniHost, splitHostPort } from "./authority.ts";
import { PROXY_ADDRESS, UNKNOWN_HOST } from "./proxy-address.ts";
import { PROXY_START_MARKER } from "./start-marker.ts";
import { BAD_REQUEST_METHOD, incompleteReason } from "./termination.ts";
import { CLIENT_ENDED_REASONS, type TrafficAction, type TrafficEvent } from "./traffic-event.ts";

export type { TrafficAction, TrafficEvent, TrafficProtocol } from "./traffic-event.ts";

// The target and the SNI come last because the build chooses their length: a
// cut line costs their tail, not the decision. Nothing should cut one, since
// both the configured line length and s6-log's split are above the longest
// request haproxy accepts, so `unparsed` counts what arrives unreadable
// rather than skipping it.
// The trailing field stays \S+ rather than .+: two lines joined by a
// half-written write would otherwise parse as one event instead of counting
// as unparsed.
// sni= is optional: the plain stage terminates no TLS and logs no such field.
// `host=` is a named field for that reason, or a line cut right after the SNI
// would parse with `sni=<name>` read as the authority instead of counting as
// unreadable.
const REQUEST =
  /^buildcage (\d+) (https?) (\S+) (-?\d+) (\d+) ts=(\S*) reason=(\S+) tlserr=(\S+) dst=(\S+):(\d+) (?:fcerr=(\S+) )?(?:sni=(\S+) )?host=(\S+) (\S+)$/;
const PASSTHROUGH =
  /^buildcage (\d+) pass (tls|tcp) (\d+) ts=(\S*) reason=(\S+) dst=(\S+):(\d+) sni=(\S+)$/;
// CoreDNS escapes a space in a label as `\ `. Names stay escaped, as the
// Corefile and known_blocked_rules match that same text.
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

/** What every line the proxy writes for us opens with. HAProxy's own
 *  [NOTICE]/[WARNING] output never does. */
const LINE_PREFIX = "buildcage ";

/** The startup marker, capturing the millisecond epoch it was printed with.
 *  qjs's Date.now() prints it, before HAProxy itself is even running; every
 *  other line's <ms> comes from HAProxy's date(0,ms). */
const START = new RegExp(`^${PROXY_START_MARKER} (\\d+)$`);

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
 * unreachable or unverified, `-` for a relayed response. A server-side timeout
 * (`s`) counts only while there is still nothing to relay: `sD` and `sL` cut
 * short a transfer the origin had already answered, and on a passthrough
 * `timeout server` is an inactivity timeout, so counting those would blame a
 * host a rule allowed. A client-side timeout (`c`) is the build dropping its
 * own connection, which the proxy never stood in the way of.
 */
function isRefusal(terminationState: string): boolean {
  const cause = terminationState[0];
  if (cause === "P" || cause === "S") return true;
  const phase = terminationState[1];
  return cause === "s" && (phase === "C" || phase === "H");
}

/**
 * Refusal reason, matching the universal engine's kebab-case vocabulary.
 *
 * The config names the refusals only it can tell apart: 502 is both our DNS
 * deny and an origin that gave up, and a passthrough reject has no status at
 * all. Everything else the phase already names, so the field stays `-`.
 *
 * Only the server's own causes name the origin. `P` is this proxy refusing,
 * whatever phase it happened in: `PH` is a response it judged invalid and `PC`
 * its own connection limit, neither of which the origin chose. In phase `R` it
 * is haproxy's own answer to bytes that parsed as no request at all, which the
 * method tells from a refusal the rules made.
 *
 * Phase `C` is a connection that never completed, and both of its reasons are
 * this proxy's own refusal. `tlserr` says which: the backend connects with
 * `ssl verify required` (see haproxy-sections.ts), and a handshake that failed
 * leaves haproxy's own error there, so `origin-untrusted` names a certificate
 * this proxy would not accept. Any error counts, whether it was forged or the
 * origin speaks no TLS at all: neither is an origin this proxy could
 * authenticate, and reading only the verify error would let the second pass as
 * an outage.
 *
 * `origin-connect-failed` is the rest of that phase, and is a refusal too
 * because it cannot be shown not to be one. `tlserr` belongs to the last
 * connection attempt alone and a failed handshake is retried, so a certificate
 * refused on one attempt leaves no trace once a later attempt fails at TCP:
 * measured on haproxy 3.4, an impostor logs `rc=3 ts=SC` with the verify error,
 * and the same impostor going silent partway through those retries logs
 * `ts=SC tlserr=-`, which is what an origin that is merely down logs too. The
 * report cannot tell them apart, so it does not claim to: a connection this
 * proxy never completed is one whose origin it never authenticated. A host that
 * is flaky rather than hostile is cleared the way any expected refusal is, with
 * known_blocked_rules.
 *
 * `tlsError` is undefined where this proxy checked no certificate at all, and
 * a connection it could not make there hid nothing: the plain stage carries
 * plaintext to `origin_plain`, which verifies nothing, and the passthrough
 * relays the handshake for the build to judge. Both stay `origin-unreachable`.
 * Only where a certificate was going to be checked is a connection that never
 * completed a refusal.
 */
function reasonFor(
  logged: string,
  terminationState: string,
  tlsError: string | undefined,
  method: string,
): string {
  if (logged !== "-") return logged;
  const cause = terminationState[0];
  if (cause !== "S" && cause !== "s") {
    return method === BAD_REQUEST_METHOD ? "bad-request" : "not-allowed";
  }
  switch (terminationState[1]) {
    case "H":
      return "origin-no-response";
    case "D":
    case "L":
      return "origin-aborted";
    default:
      if (tlsError === undefined) return "origin-unreachable";
      return cause === "S" && tlsError !== "-" && tlsError !== "0"
        ? "origin-untrusted"
        : "origin-connect-failed";
  }
}

/**
 * The refusals this proxy made over a request that named no host. The host
 * field is the `Host` the log prints as `-`, so the connection is named by its
 * handshake instead; see hostBeforeRequest.
 */
const REQUESTLESS_REASONS = new Set(["bad-request", "missing-host-header"]);

/**
 * The client-connection error haproxy sets for a broken record after the TLS
 * handshake completed. That client trusted the CA, so the termination state
 * names how it ended. Every other `SSL_*` one is set before then.
 */
const POST_HANDSHAKE_ERROR = "SSL_FATAL";

/**
 * The failures that are not this proxy's own: an origin that answered nothing
 * usable or broke off mid-transfer, one no passthrough could reach, and a name
 * the upstream resolver could not answer for a host the rules had already
 * allowed. See TrafficAction for what the report does with them.
 *
 * What the first two share is a connection that completed, which is where the
 * origin's certificate was checked: whatever went wrong afterwards, it went
 * wrong with an origin this proxy had authenticated. An inspected connection
 * that never completed is absent on purpose, `origin-connect-failed` as much as
 * `origin-untrusted`: the check guards nothing if failing it does not fail a
 * build, and the log cannot say which of the two it was. See reasonFor.
 */
const FAILURE_REASONS = new Set([
  "origin-unreachable",
  "origin-no-response",
  "origin-aborted",
  "dns-failed",
]);

/** Decided from the reason rather than from the termination state, which says
 *  that something was refused but not by whom. */
function actionFor(reason: string | undefined, isAudit: boolean): TrafficAction {
  if (reason !== undefined) return FAILURE_REASONS.has(reason) ? "failed" : "block";
  // audit enforces nothing, so nothing here was allowed by a rule. Calling it
  // "allow" would claim a decision that was never made.
  return isAudit ? "audit" : "allow";
}

/**
 * The absolute URL a request named, joined from its authority and its target,
 * or undefined where its target was no path for one to be built around.
 *
 * haproxy's `pathq` is empty, printed as `-`, for every request-target that is
 * not origin-form: the asterisk-form `OPTIONS *` of RFC 9112 §3.2.4 and a
 * CONNECT's authority. Both are legal requests that reach the rules and are
 * refused by them, since every path matcher wants a leading slash, so the
 * report still has an event to show; it just has no URL to show for it.
 */
function urlOf(scheme: string, authority: string, target: string): string | undefined {
  return target.startsWith("/") ? `${scheme}://${authority}${target}` : undefined;
}

/** The authority a URL is built around when the request carried no `Host`:
 *  the host hostBeforeRequest chose, with the port where it is not the
 *  scheme's default. RFC 9112 §3.3 builds it from the connection the same way. */
function authorityOf(host: string, port: string, scheme: "http" | "https"): string {
  return port === DEFAULT_PORT[scheme] ? host : `${host}:${port}`;
}

/**
 * The host of a connection that never delivered a whole request: its SNI, the
 * only name such a line carries, or failing that the address it was sent to.
 * The SNI keeps a trailing dot, since the allowed_tls_rules entry that would
 * pass the connection through is matched on it.
 *
 * The address names nothing where it is the proxy's own: CoreDNS answers every
 * name with it, so the connection was name-based and its name is gone. Any
 * other address is one the build wrote out itself, and only an ip rule could
 * have passed it, so `byAddress` has the report say so.
 */
function hostBeforeRequest(
  sni: string | undefined,
  address: string,
): { host: string; byAddress: boolean } {
  if (sni !== undefined && sni !== "-") return { host: sniHost(sni), byAddress: false };
  if (address === PROXY_ADDRESS) return { host: UNKNOWN_HOST, byAddress: false };
  return { host: address, byAddress: true };
}

/** Parse one proxy-log line, or null if it is not one of ours. */
function parseProxyLine(line: string, isAudit: boolean): TrafficEvent | null {
  const trimmed = line.trim();

  const request = REQUEST.exec(trimmed);
  if (request) {
    // Its termination state reads as this proxy's refusal, which it is not.
    const fcerr = request[11] ?? "";
    const tlsFailed =
      request[3] === BAD_REQUEST_METHOD &&
      fcerr.startsWith("SSL_") &&
      fcerr !== POST_HANDSHAKE_ERROR;
    const incomplete = tlsFailed ? "client-tls-failed" : incompleteReason(request[6], request[3]);
    // Only the https stage connects with `ssl verify required`; the plain one
    // logs the field all the same and has no certificate behind it. See
    // reasonFor for what that changes.
    const tlsError = request[2] === "https" ? request[8] : undefined;
    const reason =
      incomplete ??
      (isRefusal(request[6]) ? reasonFor(request[7], request[6], tlsError, request[3]) : undefined);
    // The host field holds the `Host` that never came, so the handshake is the
    // only thing left that names the connection.
    const namedByHandshake =
      reason !== undefined && (incomplete !== undefined || REQUESTLESS_REASONS.has(reason));
    // A request line that did parse is kept whole even so. The path is where a
    // payload sits, and the report is the only place a reader looks; its URL
    // is built around the same host the row carries.
    const parsedRequest = request[3] !== BAD_REQUEST_METHOD;
    const scheme = request[2] as "http" | "https";
    // Spelled as the rules saw it, like the logged path, so one host sent two
    // ways is one row and a known_blocked rule matches either spelling.
    const sent = splitHostPort(request[13]);
    const host = ruleHost(sent.host);
    const authority = sent.port === undefined ? host : `${host}:${sent.port}`;
    const unnamed = namedByHandshake ? hostBeforeRequest(request[12], request[9]) : undefined;
    const event: TrafficEvent = {
      // <ms> is milliseconds; TrafficEvent.time is seconds.
      time: Number(request[1]) / 1000,
      action: incomplete !== undefined ? "incomplete" : actionFor(reason, isAudit),
      protocol: unnamed?.byAddress ? "tcp" : scheme,
      // The `Host` header names the host; the port comes from dst=, where the
      // request was actually sent.
      host: unnamed?.host ?? host,
      port: Number(request[10]),
      destination: `${request[9]}:${request[10]}`,
    };
    if (parsedRequest) {
      event.method = request[3];
      const url = urlOf(
        scheme,
        unnamed ? authorityOf(unnamed.host, request[10], scheme) : authority,
        request[14],
      );
      if (url !== undefined) event.url = url;
    }
    if (reason !== undefined) event.reason = reason;
    else {
      event.status = Number(request[4]);
      event.bytes = Number(request[5]);
    }
    return event;
  }

  const pass = PASSTHROUGH.exec(trimmed);
  if (pass) {
    // This stage relays TLS rather than terminating it, so it has no backend
    // handshake to fail and phase `C` is only a connection that was not made.
    // It reads no request either, hence the method it could never log.
    const reason = isRefusal(pass[4]) ? reasonFor(pass[5], pass[4], undefined, "-") : undefined;
    // Only a tls rule's passthrough logs an SNI; otherwise the address names it.
    const sni = pass[8];
    const event: TrafficEvent = {
      time: Number(pass[1]) / 1000,
      action: actionFor(reason, isAudit),
      protocol: pass[2] as "tls" | "tcp",
      host: sni === "-" ? pass[6] : sniHost(sni),
      port: Number(pass[7]),
      destination: `${pass[6]}:${pass[7]}`,
    };
    // Never decrypted, so there is no status to report either way.
    if (reason !== undefined) event.reason = reason;
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
  /** Lines written for one of our rules yet matching no format above. Each
   *  may be a refusal the report cannot account for. */
  unparsed: number;
}

/** What one pass over the proxy log yields. */
export interface InspectLogScan {
  events: TrafficEvent[];
  /** Seconds since the epoch at which the proxy itself started, matching
   *  TrafficEvent.time's unit. Undefined when no marker line carried a
   *  stamp, which includes the bare marker a failed qjs leaves behind. */
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
 * consumed once, so it cannot be two separate passes. `for await` also
 * accepts a plain array, so callers with the lines already in memory pass one.
 *
 * Without `allowsName`, no SNI is judged; see refuseUnallowedNames.
 */
export async function scanInspectLog(
  lines: AsyncIterable<string> | Iterable<string>,
  isAudit = false,
  allowsName?: (name: string) => boolean,
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
    if (trimmed.startsWith(LINE_PREFIX) && !trimmed.startsWith(PROXY_START_MARKER)) unparsed++;
  }
  refuseUnpassedAddresses(events);
  if (allowsName) refuseUnallowedNames(events, allowsName);
  return { events, startedAt, headIntact: headIntact ?? false, unparsed };
}

/**
 * Refuse a connection sent straight to an address that ended before its
 * request, as `universal` does in restrict mode.
 *
 * No allowed_ip_rules entry covers the address, or the connection would have
 * been passed through. Its client sent no SNI, so the certificate this proxy
 * answered with names nothing and no client that checks it gets further.
 *
 * A client close is left alone where a request to the same address and port
 * was read, as a keepalive pool's cleanup. A passthrough proves no such thing,
 * and neither does a request on another port.
 */
function refuseUnpassedAddresses(events: TrafficEvent[]): void {
  // A proxy line always carries a destination.
  const served = new Set<string | undefined>();
  for (const event of events) {
    if (
      (event.protocol === "http" || event.protocol === "https") &&
      event.action !== "incomplete"
    ) {
      served.add(event.destination);
    }
  }
  for (const event of events) {
    // Only hostBeforeRequest's address fallback makes an incomplete line tcp.
    if (event.action !== "incomplete" || event.protocol !== "tcp") continue;
    if (CLIENT_ENDED_REASONS.has(event.reason) && served.has(event.destination)) continue;
    event.action = "block";
    event.reason = "ip-not-allowed";
  }
}

/**
 * Refuse a connection sent straight to an address that ended before its
 * request, where its SNI names a host the resolver would refuse.
 *
 * Through DNS, that attempt is refused on its dns line, which a connection to
 * an address never has. A name the rules allow stays undecided, as it does
 * through DNS. One sent to the proxy's own address came through DNS.
 */
function refuseUnallowedNames(events: TrafficEvent[], allowsName: (name: string) => boolean): void {
  for (const event of events) {
    // Only hostBeforeRequest's SNI makes an incomplete https line name a host.
    if (event.action !== "incomplete" || event.protocol !== "https") continue;
    if (event.host === UNKNOWN_HOST || allowsName(event.host)) continue;
    if (event.destination?.startsWith(`${PROXY_ADDRESS}:`)) continue;
    event.action = "block";
    event.reason = "sni-not-allowed";
  }
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
    if (line.includes(PROXY_START_MARKER)) return true;
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
    const refused = DNS_SERVICE_DENIED.exec(trimmed);
    if (!refused) {
      if (DNS_LINE.test(trimmed)) unparsed++;
      continue;
    }
    if (!service.has(refused[2])) {
      service.set(refused[2], {
        time: timeOf(refused[1]),
        host: refused[2],
        queryType: refused[3],
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

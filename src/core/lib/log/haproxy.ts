/** Log parsing library for HAProxy's buildcage decision log. */
import { ruleHost, sniHost, splitHostPort } from "./authority.ts";
import { PROXY_ADDRESS, UNKNOWN_HOST } from "./proxy-address.ts";
import { PROXY_START_MARKER } from "./start-marker.ts";
import { BAD_REQUEST_METHOD, incompleteReason } from "./termination.ts";
import type { TrafficEvent, TrafficProtocol } from "./traffic-event.ts";

export interface HaproxyLogScan {
  /** Every decision, oldest first: one connection the proxy allowed, audited,
   *  refused, or that failed after it was allowed. */
  events: TrafficEvent[];
  /** Seconds since the epoch the proxy started, from the startup marker, so the
   *  report can time each event relative to it. Undefined when the marker
   *  carried no stamp (qjs failed) or was rotated away. */
  startedAt: number | undefined;
  /** True iff the log opens with the startup marker. Anything else means its
   *  beginning is gone, rotated away or erased. */
  headIntact: boolean;
  /** Lines that open like a proxy line yet matched no format below. Each is a
   *  decision the report cannot account for. */
  unparsed: number;
}

// The quoted target and the reason are restricted to the charset the config
// actually emits (host/IP/port, and a kebab-case reason), and the line is
// anchored at both ends, so a forged target or reason is never read as a
// decision. The next field is %B, a byte count (`-` if the field is empty).
// http_in appends its termination state and destination.
const DECISION =
  /^buildcage (\d+) \[(AUDIT|ALLOWED|BLOCKED)\] \((\w+)\) "([A-Za-z0-9._:-]+)" ([A-Za-z0-9-]+) (\d+|-)(?: ts=[A-Za-z-]{2} dst=[0-9.]+:\d+)?$/;

/** http_in's line where no request parsed, so no rule set a field. */
const NO_REQUEST =
  /^buildcage (\d+) \[-\] \(HTTP\) "-" - (?:\d+|-) ts=([A-Za-z-]{2}) dst=([0-9.]+):(\d+)$/;

/** Every line the proxy writes opens with this; used to count unparsed ones. */
const LINE_PREFIX = "buildcage ";

/** The startup marker with its millisecond epoch (see s6-rc.d/haproxy/run). */
const START = new RegExp(`^${PROXY_START_MARKER} (\\d+)$`);

/** The proxy's rule kinds mapped to the protocol the timeline records. universal
 *  never terminates TLS, so an HTTPS connection is a passthrough it sees only
 *  the SNI of. Anything else is a bare TCP connection. */
const PROTOCOL: Record<string, TrafficProtocol> = {
  HTTPS: "https",
  HTTP: "http",
  IP: "tcp",
};

/**
 * A name whose upstream resolution the proxy could not complete. The config
 * rejects a host no rule covers before it ever resolves one, so a line reaching
 * this reason had already passed the allowlist. See TrafficAction for why such
 * a row is kept apart from a refusal.
 */
const FAILURE_REASONS = new Set(["dns-failed"]);

/** Every name resolves to the proxy's own address, so that one names no host.
 *  An HTTPS line names the SNI. */
function hostOf(address: string, ruleType?: string): string {
  if (address === PROXY_ADDRESS) return UNKNOWN_HOST;
  return ruleType === "HTTPS" ? sniHost(address) : ruleHost(address);
}

/**
 * Single forward pass over the log, producing the timeline the report builds
 * its tables and Communication details from. `isAudit` picks which decision
 * counts as passed (AUDIT vs ALLOWED); the other, if it somehow appears, is
 * dropped rather than recorded.
 */
export async function scanHaproxyLog(
  lines: AsyncIterable<string> | Iterable<string>,
  isAudit: boolean,
): Promise<HaproxyLogScan> {
  const events: TrafficEvent[] = [];
  const passedDecision = isAudit ? "AUDIT" : "ALLOWED";
  let startedAt: number | undefined;
  let headIntact: boolean | undefined;
  let unparsed = 0;

  for await (const line of lines) {
    const m = DECISION.exec(line);
    if (m) {
      headIntact ??= false;
      const [, ms, decision, ruleType, target, reason, bytes] = m;
      if (decision !== passedDecision && decision !== "BLOCKED") continue;
      const { host: address, port } = splitHostPort(target);
      const host = hostOf(address, ruleType);
      const failed = decision === "BLOCKED" && FAILURE_REASONS.has(reason);
      const refused = decision === "BLOCKED" && !failed;
      const event: TrafficEvent = {
        time: Number(ms) / 1000,
        action: failed ? "failed" : refused ? "block" : isAudit ? "audit" : "allow",
        protocol: PROTOCOL[ruleType] ?? "tcp",
        host,
      };
      if (port !== undefined) event.port = Number(port);
      // A refusal names its reason and carries no payload; an allowed
      // connection is the other way round.
      if (refused || failed) event.reason = reason;
      else if (bytes !== "-") event.bytes = Number(bytes);
      events.push(event);
      continue;
    }
    const none = NO_REQUEST.exec(line);
    if (none) {
      headIntact ??= false;
      const [, ms, terminationState, address, port] = none;
      const ended = incompleteReason(terminationState, BAD_REQUEST_METHOD);
      events.push({
        time: Number(ms) / 1000,
        // Blocked in audit too: bytes that are no request have nothing to pass on.
        action: ended === undefined ? "block" : "incomplete",
        protocol: "http",
        host: hostOf(address),
        port: Number(port),
        reason: ended ?? "bad-request",
      });
      continue;
    }
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const start = START.exec(trimmed);
    headIntact ??= start !== null;
    if (start && startedAt === undefined) startedAt = Number(start[1]) / 1000;
    if (trimmed.startsWith(LINE_PREFIX) && !trimmed.startsWith(PROXY_START_MARKER)) unparsed++;
  }

  return { events, startedAt, headIntact: headIntact ?? false, unparsed };
}

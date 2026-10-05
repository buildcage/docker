/**
 * The domain model of the `inspect` engine: one thing a build did, produced by
 * the log parser (inspect.ts) and consumed by the report layer.
 */

import { ruleHost } from "./authority.ts";
import { UNKNOWN_HOST } from "./proxy-address.ts";

/**
 * What a rule decided, or would have decided had one been enforced.
 *
 * `discovery`, `incomplete` and `failed` are none of those: no rule decided
 * them and none could. Folding any into `block` would put a row in the report
 * no rule could take away, and fail a build under fail_on_blocked over
 * something the rules had nothing to say about. A service name is answered
 * empty whatever the rules say, a connection nobody ended on purpose gave a
 * rule nothing to judge, and `failed` is what became of a request the rules had
 * already allowed.
 *
 * A request this proxy refused before one had wholly arrived is a `block` like
 * any other, though: it refused rather than stood by, and a rule does clear it
 * (see the bad-request remedy in docs/reference.md). So is one sent straight to
 * an address no ip rule covers that ended before its request; see
 * refuseUnpassedAddresses in inspect.ts. `incomplete` is only what the client
 * or the proxy's own machinery ended.
 *
 * `failed` alone names a host worth tabulating: the rules passed on it and the
 * name is the one the build asked for, so it gets a table where the other two
 * reach only the timeline.
 */
export type TrafficAction = "allow" | "block" | "audit" | "discovery" | "incomplete" | "failed";

export type TrafficProtocol = "https" | "http" | "tls" | "tcp" | "dns";

/** One thing the build did. */
export interface TrafficEvent {
  /** When it started, in seconds since the epoch. */
  time: number;
  action: TrafficAction;
  protocol: TrafficProtocol;
  /** The name asked for, as ruleHost (or sniHost, for a name from the SNI)
   *  folds it, or the address when there was no name. */
  host: string;
  /** Absent for dns, which connects to nothing. */
  port?: number;
  /** dns only, and only where the type is the point: a discovery lookup, or a
   *  refused service name. */
  queryType?: string;
  /** http and https only. */
  method?: string;
  /** http and https only. Absolute, query string included. */
  url?: string;
  /** http and https only, and only when the exchange completed. */
  status?: number;
  /** Bytes returned to the build. Absent for dns and for a refusal. */
  bytes?: number;
  /** Why it was refused, or what cut it short before a rule saw it. Set when
   *  action is "block" or "incomplete". */
  reason?: string;
  /** Address it was actually sent to. Absent for dns. */
  destination?: string;
}

/** The hosts a run connected to, for isRedundantDns. */
export interface ConnectedHosts {
  any: Set<string>;
  blocked: Set<string>;
}

/** What a client ending a connection before its request is logged as. */
export const CLIENT_ENDED_REASONS: ReadonlySet<string | undefined> = new Set([
  "client-aborted",
  "client-timeout",
]);

/**
 * Given a whole timeline, which client-ended `incomplete` connections
 * (client-aborted, client-timeout) are only noise and are left out of the
 * report: those to a host the client also got a request read on, where the
 * close is a keepalive pool cleaning up after its work. Any non-dns event but
 * these closes proves as much, since an allowed, refused or origin-failed
 * request each took a completed handshake first. A host with none keeps its
 * closes, since then every attempt to it ended before a request, as a client
 * that cannot trust the CA does (a container missing `ca-certificates`). The
 * raw traffic artifact keeps them all either way.
 *
 * `(unknown)` is no single host, so it proves nothing about a close.
 */
export function clientEndedNoise(timeline: TrafficEvent[]): (event: TrafficEvent) => boolean {
  const completed = new Set<string>();
  for (const event of timeline) {
    if (event.protocol !== "dns" && event.action !== "incomplete" && event.host !== UNKNOWN_HOST) {
      completed.add(ruleHost(event.host));
    }
  }
  // A close is named by its SNI, which may keep a dot the request's Host lost.
  return (event) =>
    event.action === "incomplete" &&
    CLIENT_ENDED_REASONS.has(event.reason) &&
    completed.has(ruleHost(event.host));
}

/** Index a timeline once. The check below runs for every lookup, and rescanning
 *  the whole timeline for each would be quadratic. */
export function connectedHosts(timeline: TrafficEvent[]): ConnectedHosts {
  const connected: ConnectedHosts = { any: new Set(), blocked: new Set() };
  for (const event of timeline) {
    // Where these are all a host left, as from a client that cannot trust the
    // CA, its lookup is the only row a table has for it.
    if (event.protocol === "dns" || event.action === "incomplete") continue;
    // The resolver logs every name without the dot an SNI may keep.
    const host = ruleHost(event.host);
    connected.any.add(host);
    if (event.action === "block") connected.blocked.add(host);
  }
  return connected;
}

/**
 * A lookup is the sole trace of a name the build never connected to, and worth
 * keeping for that. Once a connection to the same name also reaches a host
 * table, it says nothing that connection does not and only doubles the row.
 *
 * A refused lookup takes a refused connection to cover it. An allowed request
 * for a name the resolver refused would mean the two disagreed about that host,
 * which a reader should see rather than have collapsed away.
 *
 * A discovery lookup is never redundant: it asks about `_service._proto.<host>`,
 * which nothing connects to, and its query type is the point of the row.
 */
export function isRedundantDns(event: TrafficEvent, connected: ConnectedHosts): boolean {
  if (event.protocol !== "dns" || event.action === "discovery") return false;
  return event.action === "block"
    ? connected.blocked.has(event.host)
    : connected.any.has(event.host);
}

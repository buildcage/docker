/**
 * The domain model of the `inspect` engine: one thing a build did, produced by
 * the log parser (inspect.ts) and consumed by the report layer.
 */

/** What a rule permitted, or would have permitted had one been enforced. */
export type TrafficAction = "allow" | "block" | "audit";

export type TrafficProtocol = "https" | "http" | "tls" | "tcp" | "dns";

/** One thing the build did. */
export interface TrafficEvent {
  /** When it started, in seconds since the epoch. */
  time: number;
  action: TrafficAction;
  protocol: TrafficProtocol;
  /** The name asked for, or the address when there was no name. */
  host: string;
  /** Absent for dns, which connects to nothing. */
  port?: number;
  /** http and https only. */
  method?: string;
  /** http and https only. Absolute, query string included. */
  url?: string;
  /** http and https only, and only when the exchange completed. */
  status?: number;
  /** Bytes returned to the build. Absent for dns and for a refusal. */
  bytes?: number;
  /** Why it was refused. Set only when action is "block". */
  reason?: string;
  /** Address it was actually sent to. Absent for dns. */
  destination?: string;
}

/**
 * A blocked DNS-only lookup is worth keeping on its own -- it is the sole
 * trace of a name the build never actually connected to -- but once the same
 * host also shows up as a blocked request elsewhere in the timeline, the DNS
 * line says nothing that request does not already say, and only doubles the
 * row.
 */
export function isRedundantBlockedDns(event: TrafficEvent, timeline: TrafficEvent[]): boolean {
  if (event.protocol !== "dns" || event.action !== "block") return false;
  return timeline.some(
    (e) => e !== event && e.protocol !== "dns" && e.host === event.host && e.action === "block",
  );
}

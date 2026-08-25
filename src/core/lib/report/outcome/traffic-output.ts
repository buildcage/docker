/**
 * Writes the observed traffic to a file the report action can upload as an
 * artifact, so whoever wants it later can act on what a build reached
 * instead of reading it out of a summary.
 *
 * Only the inspect engine can produce this: it decrypts, so it has the method
 * and full URL of every request, refused ones included. The other engines see
 * host and port only.
 */

import { writeFileSync } from "node:fs";
import { formatElapsedFixed } from "../elapsed-time.ts";
import type { TrafficEvent } from "#core/lib/log/traffic-event.ts";

/** One event, as it appears in the JSON. */
export interface TrafficRecord {
  /** ISO 8601 UTC, from the proxy's own clock. */
  time: string;
  /** Time since the proxy itself started, always HH:MM:SS.mmm -- the shape
   *  never changes between a short and a long run. Absent when the proxy's
   *  start time could not be determined (logLooksPlausible false); never
   *  fabricated from something else. */
  elapsed?: string;
  /** `allow`, `block`, or `audit` when nothing was being enforced. */
  action: string;
  /** `https`, `http`, `tls`, `tcp` or `dns`. */
  protocol: string;
  host: string;
  /** Absent for dns, which connects to nothing. */
  port?: number;
  /** http and https only. */
  method?: string;
  url?: string;
  /** Absent for a refusal, for dns, and for anything not decrypted. */
  status?: number;
  /** Absent for a refusal and for dns. */
  bytes?: number;
  /** Present only when action is `block`. */
  reason?: string;
}

/**
 * Build the records for one run, oldest first.
 *
 * Includes name lookups that merely resolved, unlike the summary: the volume is
 * cheap for a machine reader, and a name resolved but never connected to is how
 * a too-wide rule being probed shows up. A field is absent when it does not
 * apply, never zero, so filter on `action`, not `status`.
 */
export function buildTrafficRecords(
  events: TrafficEvent[],
  startedAt: number | undefined,
): TrafficRecord[] {
  return [...events]
    .sort((a, b) => a.time - b.time)
    .map((e) => {
      const record: TrafficRecord = {
        time: new Date(e.time * 1000).toISOString(),
        action: e.action,
        protocol: e.protocol,
        host: e.host,
      };
      if (startedAt !== undefined) record.elapsed = formatElapsedFixed(e.time - startedAt);
      if (e.port !== undefined) record.port = e.port;
      if (e.method !== undefined) record.method = e.method;
      if (e.url !== undefined) record.url = e.url;
      if (e.status !== undefined) record.status = e.status;
      if (e.bytes !== undefined) record.bytes = e.bytes;
      if (e.reason !== undefined) record.reason = e.reason;
      return record;
    });
}

/** Write the same records to a file, indented, for the report action to upload
 *  as an artifact (fetchable after the run, unlike a job output). */
export function writeTrafficFile(path: string, records: TrafficRecord[]): void {
  writeFileSync(path, JSON.stringify(records, null, 2) + "\n");
}

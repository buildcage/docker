/**
 * Writes the observed traffic to a file this action can upload as an
 * artifact, so whoever wants it later can act on what a step reached
 * instead of reading it out of a summary.
 *
 * Both engines produce this now: inspect records each request whole, universal
 * a coarser connection-level view (host, port and bytes, no method or URL).
 */

import { writeFileSync } from "node:fs";

import type { TrafficEvent } from "#core/lib/log/traffic-event.ts";

import { formatElapsedFixed } from "../elapsed-time.ts";

/** The objects an action's own check adds to a record, by name. */
export type TrafficExtensions = Record<string, Record<string, string>>;

/**
 * One event, as it appears in the JSON: the same event the report renders,
 * with the time written as text and the elapsed time alongside it, and the
 * objects in its `extensions` raised to the top level, typed by the action as
 * `X`. Every other field is documented on TrafficEvent.
 */
export type TrafficRecord<X extends TrafficExtensions = Record<never, never>> = Omit<
  TrafficEvent,
  "time" | "extensions"
> & {
  /** ISO 8601 UTC, from the proxy's own clock. */
  time: string;
  /** Time since the proxy itself started, as formatElapsedFixed writes it.
   *  Absent when the proxy's start time could not be determined; never
   *  fabricated from something else. */
  elapsed?: string;
} & Partial<X>;

/**
 * Build the records for one run, oldest first.
 *
 * Includes every name lookup; the summary's tables hold only those with no
 * request behind them. The volume is cheap for a machine reader, and which
 * names were asked about is not always derivable from what was then connected
 * to. A field is absent when it does not apply, never zero, so filter on
 * `action`, not `status`.
 */
export function buildTrafficRecords<X extends TrafficExtensions = Record<never, never>>(
  events: TrafficEvent[],
  startedAt: number | undefined,
): TrafficRecord<X>[] {
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
      if (e.queryType !== undefined) record.queryType = e.queryType;
      if (e.method !== undefined) record.method = e.method;
      if (e.url !== undefined) record.url = e.url;
      if (e.status !== undefined) record.status = e.status;
      if (e.bytes !== undefined) record.bytes = e.bytes;
      if (e.reason !== undefined) record.reason = e.reason;
      if (e.destination !== undefined) record.destination = e.destination;
      if (e.wouldRefuse !== undefined) record.wouldRefuse = e.wouldRefuse;
      // Never over a field of the record's own.
      for (const [name, fields] of Object.entries(e.extensions ?? {})) {
        if (!(name in record)) Object.assign(record, { [name]: fields });
      }
      // X is the action's word for what its own fields hold.
      return record as TrafficRecord<X>;
    });
}

/** Write the same records to a file, indented, for this action to upload as
 *  an artifact (fetchable after the run, unlike a job output). */
export function writeTrafficFile<X extends TrafficExtensions>(
  path: string,
  records: TrafficRecord<X>[],
): void {
  writeFileSync(path, JSON.stringify(records, null, 2) + "\n");
}

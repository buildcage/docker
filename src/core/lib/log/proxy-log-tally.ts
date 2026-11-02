/** What a proxy log's lines other than its events say about the log itself. */
import { PROXY_LOG_BARRIER, ringDropped } from "./proxy-notices.ts";
import { PROXY_START_MARKER } from "./start-marker.ts";

/** What every line the proxy writes for us opens with. HAProxy's own
 *  [NOTICE]/[WARNING] output never does. */
const LINE_PREFIX = "buildcage ";

/** The startup marker, capturing the millisecond epoch start-marker.lua stamps
 *  it with; every other line's <ms> comes from HAProxy's date(0,ms). */
const START = new RegExp(`^${PROXY_START_MARKER} (\\d+)$`);

export interface ProxyLogTally {
  /** Seconds since the epoch at which the proxy itself started, matching
   *  TrafficEvent.time's unit. Undefined when no marker line carried a stamp. */
  startedAt: number | undefined;
  /** True iff the log opens with the startup marker. Stricter than
   *  `startedAt`: a restart writes a second marker, which would otherwise
   *  vouch for a beginning that had already rotated away. */
  headIntact: boolean;
  /** Lines that open as the proxy's own yet match no format the parser knows.
   *  Each is an event the report cannot account for. */
  unparsed: number;
  /** Startup markers after the log's first line: each is the proxy starting
   *  again after it stopped mid-run. */
  restarts: number;
  /** Lines the proxy said it dropped because its log ring was full. */
  dropped: number;
}

/** Fed every line of one pass over the proxy log, in order. */
export function createProxyLogTally(): {
  /** A line the parser read as an event. */
  event(): void;
  /** Any other line. */
  other(line: string): void;
  result(): ProxyLogTally;
} {
  let startedAt: number | undefined;
  let headIntact: boolean | undefined;
  let unparsed = 0;
  let restarts = 0;
  let dropped = 0;
  return {
    event() {
      headIntact ??= false;
    },
    other(line) {
      const trimmed = line.trim();
      if (trimmed === "") return;
      const lost = ringDropped(trimmed);
      if (lost !== undefined) {
        dropped += lost;
        return;
      }
      const start = START.exec(trimmed);
      if (start && headIntact !== undefined) restarts++;
      headIntact ??= start !== null;
      if (start && startedAt === undefined) startedAt = Number(start[1]) / 1000;
      if (
        trimmed.startsWith(LINE_PREFIX) &&
        !trimmed.startsWith(PROXY_START_MARKER) &&
        !trimmed.startsWith(PROXY_LOG_BARRIER)
      ) {
        unparsed++;
      }
    },
    result() {
      return { startedAt, headIntact: headIntact ?? false, unparsed, restarts, dropped };
    },
  };
}

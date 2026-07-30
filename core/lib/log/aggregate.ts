export interface LogEntry {
  host: string;
  port: string;
  ruleType: string;
  reason: string;
}

export interface AggregatedEntry extends LogEntry {
  count: number;
}

function compareAggregated(a: AggregatedEntry, b: AggregatedEntry): number {
  return (
    b.count - a.count ||
    (a.host < b.host ? -1 : a.host > b.host ? 1 : 0) ||
    Number(a.port) - Number(b.port)
  );
}

/**
 * Aggregate log entries by (host, port, ruleType, reason) with counts, sorted
 * descending.
 */
export function aggregate(filtered: LogEntry[]): AggregatedEntry[] {
  const map: Record<string, number> = {};
  for (const e of filtered) {
    const key = `${e.host}\t${e.port}\t${e.ruleType}\t${e.reason}`;
    map[key] = (map[key] || 0) + 1;
  }
  return Object.keys(map)
    .map((key) => {
      const [host, portStr, ruleType, reason] = key.split("\t");
      return { host, port: portStr, ruleType, reason, count: map[key] };
    })
    .sort(compareAggregated);
}

export interface IncrementalAggregator {
  add(entry: LogEntry): void;
  toSortedArray(): AggregatedEntry[];
}

/** Streaming counterpart to aggregate(): folds one entry at a time into a
 *  running Map, bounding memory by the number of unique combinations seen
 *  rather than by input length. */
export function createIncrementalAggregator(): IncrementalAggregator {
  const map = new Map<string, AggregatedEntry>();
  return {
    add(entry) {
      const key = `${entry.host}\t${entry.port}\t${entry.ruleType}\t${entry.reason}`;
      const existing = map.get(key);
      if (existing) {
        existing.count++;
      } else {
        map.set(key, { ...entry, count: 1 });
      }
    },
    toSortedArray() {
      return [...map.values()].sort(compareAggregated);
    },
  };
}

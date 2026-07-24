export interface LogEntry {
  host: string;
  port: string;
  ruleType: string;
  reason: string;
}

export interface AggregatedEntry extends LogEntry {
  count: number;
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
    .sort(
      (a, b) =>
        b.count - a.count ||
        (a.host < b.host ? -1 : a.host > b.host ? 1 : 0) ||
        Number(a.port) - Number(b.port),
    );
}

/**
 * Aggregate log entries by (host, port, ruleType, reason) with counts, sorted
 * descending. Shared by transparent mode's log-parser.js and explicit mode's
 * buildkitd-log-parser.js — both produce entries in this same shape despite
 * parsing entirely different log formats.
 *
 * @param {{ host: string, port: string, ruleType: string, reason: string }[]} filtered
 * @returns {{ host: string, port: string, ruleType: string, reason: string, count: number }[]}
 */
export function aggregate(filtered) {
  const map = {};
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

/**
 * Log parsing and aggregation library for HAProxy buildcage logs.
 */

const logPattern =
  /^\[.*?\]\s+buildcage\s+\[(AUDIT|ALLOWED|BLOCKED)\]\s+\((\w+)\)\s+"([^"]+)"\s*(\S*)/;

/**
 * Parse log text into structured entries.
 *
 * @param {string} logText
 * @returns {{ decision: string, ruleType: string, host: string, port: string, reason: string }[]}
 */
export function parseEntries(logText) {
  const entries = [];
  for (const line of logText.split("\n")) {
    const m = line.match(logPattern);
    if (m) {
      const [_, decision, ruleType, hostPort, reason] = m;
      const colonIdx = hostPort.lastIndexOf(":");
      let host, port;
      if (colonIdx > 0) {
        host = hostPort.substring(0, colonIdx);
        port = hostPort.substring(colonIdx + 1);
      } else {
        host = hostPort;
        port = "0";
      }
      entries.push({
        decision,
        ruleType,
        host,
        port,
        reason: reason || "-",
      });
    }
  }
  return entries;
}

/**
 * Aggregate entries by (host, port, ruleType, reason) with counts, sorted descending.
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
    .map(key => {
      const [host, portStr, ruleType, reason] = key.split("\t");
      return { host, port: portStr, ruleType, reason, count: map[key] };
    })
    .sort((a, b) =>
      b.count - a.count ||
      (a.host < b.host ? -1 : a.host > b.host ? 1 : 0) ||
      Number(a.port) - Number(b.port)
    );
}

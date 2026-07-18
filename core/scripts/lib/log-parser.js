/**
 * Log parsing library for HAProxy buildcage logs. aggregate() lives
 * separately in core/shared/lib/aggregate.js and is not re-exported here.
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

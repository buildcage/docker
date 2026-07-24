/**
 * Log parsing library for HAProxy buildcage logs. aggregate() lives
 * separately in core/shared/lib/aggregate.js and is not re-exported here.
 */

export interface LogEntry {
  decision: string;
  ruleType: string;
  host: string;
  port: string;
  reason: string;
}

const logPattern =
  /^\[.*?\]\s+buildcage\s+\[(AUDIT|ALLOWED|BLOCKED)\]\s+\((\w+)\)\s+"([^"]+)"\s*(\S*)/;

/**
 * Parse log text into structured entries.
 */
export function parseEntries(logText: string): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const line of logText.split("\n")) {
    const m = line.match(logPattern);
    if (m) {
      const [, decision, ruleType, hostPort, reason] = m;
      const colonIdx = hostPort.lastIndexOf(":");
      let host: string;
      let port: string;
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

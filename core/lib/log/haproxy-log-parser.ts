/**
 * Log parsing library for HAProxy buildcage logs. aggregate() lives
 * separately in core/lib/log/aggregate.js and is not re-exported here.
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

/**
 * True iff logText contains at least one non-blank line that is not a
 * buildcage-decision line. A genuine HAProxy process always produces some
 * such content (its own startup/notice output, merged into this same log
 * via the s6 pipeline) before any traffic occurs, regardless of whether
 * any connection was ever blocked. A log consisting only of forged/replayed
 * decision lines — or nothing at all — lacks this, which is a signal (not
 * a guarantee) that the log may have been tampered with rather than
 * reflecting a real run.
 */
export function hasNonBuildcageContent(logText: string): boolean {
  return logText.split("\n").some((line) => line.trim() !== "" && !logPattern.test(line));
}

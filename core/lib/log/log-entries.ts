export interface LogEntry {
  level: "info" | "debug" | "warning" | "error";
  log: string;
}

/**
 * Wraps raw log text as a GitHub Actions collapsible group, expressed as
 * plain info-level LogEntry items rather than literal ::group::/::endgroup::
 * handling in report/src/main.ts — it just prints each entry via
 * console[level], so the group markers ride along as ordinary entries.
 * Returns [] for empty log text (nothing to show, no empty group).
 */
export function wrapLogGroup(title: string, logText: string): LogEntry[] {
  if (!logText) return [];
  return [
    { level: "info", log: `::group::${title}` },
    { level: "info", log: logText },
    { level: "info", log: "::endgroup::" },
  ];
}

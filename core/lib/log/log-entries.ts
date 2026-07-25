/**
 * Wraps raw log text as a GitHub Actions collapsible group, as plain lines
 * rather than literal ::group::/::endgroup:: handling elsewhere — report.sh
 * just prints each line as-is. Returns [] for empty log text (nothing to
 * show, no empty group).
 */
export function wrapLogGroup(title: string, logText: string): string[] {
  if (!logText) return [];
  return [`::group::${title}`, logText, "::endgroup::"];
}

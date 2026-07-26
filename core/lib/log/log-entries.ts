/** Wraps text as a GitHub Actions collapsible group. Returns [] when empty,
 *  so callers don't emit an empty group. */
export function wrapLogGroup(title: string, logText: string): string[] {
  if (!logText) return [];
  return [`::group::${title}`, logText, "::endgroup::"];
}

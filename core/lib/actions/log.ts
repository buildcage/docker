/** Logs a labeled ACL rule list, one rule per line, for a `::group::` block. */
export function logRules(label: string, rules: string[]): void {
  console.log(`${label} rules:${rules.length === 0 ? " (none)" : ""}`);
  for (const r of rules) console.log(`  ${r}`);
}

/** Wraps text as a GitHub Actions collapsible group. Returns [] when empty,
 *  so callers don't emit an empty group. */
export function wrapLogGroup(title: string, logText: string): string[] {
  if (!logText) return [];
  return [`::group::${title}`, logText, "::endgroup::"];
}

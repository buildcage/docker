/** Logs a labeled ACL rule list, one rule per line, for a `::group::` block. */
export function logRules(label: string, rules: string[]): void {
  console.log(`${label} rules:${rules.length === 0 ? " (none)" : ""}`);
  for (const r of rules) console.log(`  ${r}`);
}

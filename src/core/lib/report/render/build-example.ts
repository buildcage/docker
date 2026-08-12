import type { AggregatedEntry } from "#core/lib/log/aggregate.ts";

const ruleTypeToParam: Record<string, string> = {
  HTTPS: "allowed_https_rules",
  HTTP: "allowed_http_rules",
  IP: "allowed_ip_rules",
};

export type AuditedRow = Pick<AggregatedEntry, "host" | "port" | "ruleType">;

/**
 * Build a restrict-mode YAML configuration example from audited rows.
 * Returns a markdown string wrapped in <details> tags, or "" if no rows.
 *
 * actionRef is the ref (tag or commit SHA) this action was invoked with.
 * setup's action.yml lives at the repo root (not a subdirectory), so the
 * example's `uses:` never has an action-name path segment.
 */
export function buildRestrictExample(
  auditedRows: AuditedRow[] | null | undefined,
  actionRepo: string,
  actionRef?: string,
): string {
  if (!auditedRows || auditedRows.length === 0) return "";

  // A 40-char SHA is opaque to the reader and specific to this run, so show a
  // placeholder instead; a tag (e.g. v2, v2.1.0) is stable and useful as-is.
  const ref = /^[0-9a-f]{40}$/i.test(actionRef!) ? "<sha>" : actionRef;

  // Group by ruleType, preserving order of first appearance
  const groups = new Map<string, string[]>();
  for (const r of auditedRows) {
    const param = ruleTypeToParam[r.ruleType];
    if (!param) continue;
    if (!groups.has(param)) groups.set(param, []);
    groups.get(param)!.push(`${r.host}:${r.port}`);
  }

  if (groups.size === 0) return "";

  // Build YAML lines
  let yaml = "";
  yaml += "- name: Start Buildcage in restrict mode\n";
  yaml += `  uses: ${actionRepo}@${ref}\n`;
  yaml += "  with:\n";
  yaml += "    proxy_mode: restrict\n";
  for (const [param, rules] of groups) {
    yaml += `    ${param}: >-\n`;
    for (const rule of rules) {
      yaml += `      ${rule}\n`;
    }
  }

  let md = "\n<details>\n";
  md += "<summary>🛡️ Switch to restrict mode</summary>\n\n";
  md += "```yaml\n";
  md += yaml;
  md += "```\n\n";
  md += "</details>\n";
  return md;
}

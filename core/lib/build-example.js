const ruleTypeToParam = {
  HTTPS: "allowed_https_rules",
  HTTP: "allowed_http_rules",
  IP: "allowed_ip_rules",
};

/**
 * Build a restrict-mode YAML configuration example from audited rows.
 * Returns a markdown string wrapped in <details> tags, or "" if no rows.
 *
 * @param {Array<{host: string, port: string, ruleType: string}>} auditedRows
 * @param {string} actionRepo
 * @param {string} actionRef - the ref (tag or commit SHA) this action was invoked with
 * @param {{actionName?: string, runCommand?: string}} [options] - actionName: "setup" (default) or "run"; runCommand: the `run:` input, included only when actionName is "run"
 * @returns {string}
 */
export function buildRestrictExample(auditedRows, actionRepo, actionRef, { actionName = "setup", runCommand } = {}) {
  if (!auditedRows || auditedRows.length === 0) return "";

  // A 40-char SHA is opaque to the reader and specific to this run, so show a
  // placeholder instead; a tag (e.g. v2, v2.1.0) is stable and useful as-is.
  const ref = /^[0-9a-f]{40}$/i.test(actionRef) ? "<sha>" : actionRef;

  // Group by ruleType, preserving order of first appearance
  const groups = new Map();
  for (const r of auditedRows) {
    const param = ruleTypeToParam[r.ruleType];
    if (!param) continue;
    if (!groups.has(param)) groups.set(param, []);
    groups.get(param).push(`${r.host}:${r.port}`);
  }

  if (groups.size === 0) return "";

  // Build YAML lines
  let yaml = "";
  yaml += "- name: Start Buildcage in restrict mode\n";
  yaml += `  uses: ${actionRepo}/${actionName}@${ref}\n`;
  yaml += "  with:\n";
  // `run` is a single self-contained step, so the example must repeat the
  // run: command to stay copy-pasteable on its own.
  if (actionName === "run" && runCommand) {
    yaml += "    run: |\n";
    // GitHub Actions' `run: |` block scalar always keeps one trailing
    // newline (YAML's default "clip" chomping), which would otherwise
    // split into a spurious blank line at the end.
    for (const line of runCommand.replace(/\r?\n$/, "").split(/\r?\n/)) {
      yaml += `      ${line}\n`;
    }
  }
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

"use strict";

var node_child_process = require("node:child_process"), node_fs = require("node:fs"), node_path = require("node:path"), node_url = require("node:url"), _documentCurrentScript = "undefined" != typeof document ? document.currentScript : null;

const ruleTypeToParam = {
  HTTPS: "allowed_https_rules",
  HTTP: "allowed_http_rules",
  IP: "allowed_ip_rules"
};

const __dirname$1 = node_path.dirname(node_url.fileURLToPath("undefined" == typeof document ? require("url").pathToFileURL(__filename).href : _documentCurrentScript && "SCRIPT" === _documentCurrentScript.tagName.toUpperCase() && _documentCurrentScript.src || new URL("main.cjs", document.baseURI).href)), composeFile = process.argv[2] || node_path.join(__dirname$1, "../..", "setup", "compose.yaml"), composeEnv = {
  ...process.env,
  BUILDER_NAME: process.env.INPUT_BUILDER_NAME || "buildcage"
};

let jsonOutput;

try {
  jsonOutput = node_child_process.execFileSync("docker", [ "compose", "-f", composeFile, "exec", "builder", "qjs", "-m", "/opt/buildcage/tools/report.js" ], {
    encoding: "utf8",
    stdio: [ "ignore", "pipe", "pipe" ],
    env: composeEnv
  });
} catch (e) {
  console.log("Failed to get report from container:", e.message), process.exit(1);
}

const report = JSON.parse(jsonOutput);

console.log("::group::HTTP Proxy communication logs");

try {
  const rawLog = node_child_process.execFileSync("docker", [ "compose", "-f", composeFile, "exec", "builder", "cat", "/var/log/haproxy/current" ], {
    encoding: "utf8",
    stdio: [ "ignore", "pipe", "pipe" ],
    env: composeEnv
  });
  process.stdout.write(rawLog);
} catch {
  console.log("(failed to read raw log)");
}

if (console.log("::endgroup::"), console.log(), null === report.mode) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  summaryFile && node_fs.appendFileSync(summaryFile, "No proxy logs found.\n"), console.log("No proxy logs found."), 
  process.exit(0);
}

function markdownTable(rows, {showReason: showReason = !1} = {}) {
  if (showReason) {
    const lines = [ "| Host | Rule | Reason | Count |", "| --- | --- | --- | ---: |" ];
    for (const r of rows) lines.push(`| ${r.host}:${r.port} | ${r.ruleType} | ${r.reason} | ${r.count} |`);
    return lines.join("\n");
  }
  const lines = [ "| Host | Rule | Count |", "| --- | --- | ---: |" ];
  for (const r of rows) lines.push(`| ${r.host}:${r.port} | ${r.ruleType} | ${r.count} |`);
  return lines.join("\n");
}

const actionRepo = process.env.GITHUB_ACTION_REPOSITORY || "dash14/buildcage", isAudit = "audit" === report.mode;

let markdown = `## Outbound Traffic Report during Docker Build (${report.mode} mode)\n\n`;

if (isAudit) {
  const audited = report.sections.audited || [];
  audited.length > 0 && (markdown += "### 📋 Audited Hosts\n\n" + markdownTable(audited) + "\n"), 
  markdown += function(auditedRows, actionRepo) {
    if (!auditedRows || 0 === auditedRows.length) return "";
    const groups = new Map;
    for (const r of auditedRows) {
      const param = ruleTypeToParam[r.ruleType];
      param && (groups.has(param) || groups.set(param, []), groups.get(param).push(`${r.host}:${r.port}`));
    }
    if (0 === groups.size) return "";
    let yaml = "";
    yaml += "- name: Start Buildcage in restrict mode\n", yaml += `  uses: ${actionRepo}/setup@v2\n`, 
    yaml += "  with:\n", yaml += "    proxy_mode: restrict\n";
    for (const [param, rules] of groups) {
      yaml += `    ${param}: >-\n`;
      for (const rule of rules) yaml += `      ${rule}\n`;
    }
    let md = "\n<details>\n";
    return md += "<summary>🛡️ Switch to restrict mode</summary>\n\n", md += "```yaml\n", 
    md += yaml, md += "```\n\n", md += "</details>\n", md;
  }(audited, actionRepo);
  const blocked = report.sections.blocked || [];
  blocked.length > 0 && (audited.length > 0 && (markdown += "\n"), markdown += "### 🚫 Blocked Hosts\n\n" + markdownTable(blocked, {
    showReason: !0
  }) + "\n");
} else {
  const allowed = report.sections.allowed || [], blocked = report.sections.blocked || [];
  allowed.length > 0 && (markdown += "### ✅ Allowed Hosts\n\n" + markdownTable(allowed) + "\n"), 
  allowed.length > 0 && blocked.length > 0 && (markdown += "\n"), blocked.length > 0 && (markdown += "### 🚫 Blocked Hosts\n\n" + markdownTable(blocked, {
    showReason: !0
  }) + "\n");
}

markdown += "\n<sub>*Note: HTTP rules are based on the Host header, HTTPS rules on SNI, and IP rules on the destination IP address.*</sub>\n", 
markdown += `\n*Reported by [Buildcage](https://github.com/${actionRepo})*\n`;

const summaryFile = process.env.GITHUB_STEP_SUMMARY;

if (summaryFile ? node_fs.appendFileSync(summaryFile, markdown) : console.log(markdown), 
report.blockedCount > 0) if (isAudit) console.log(`::notice::${report.blockedCount} blocked connection(s) detected by buildcage proxy`); else {
  "true" === (process.env.INPUT_FAIL_ON_BLOCKED || "true").toLowerCase() ? (console.log(`::error::${report.blockedCount} blocked connection(s) detected by buildcage proxy`), 
  process.exitCode = 1) : console.log(`::notice::${report.blockedCount} blocked connection(s) detected by buildcage proxy`);
}

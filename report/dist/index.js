'use strict';

var node_child_process = require('node:child_process');
var node_fs = require('node:fs');
var node_path = require('node:path');
var node_url = require('node:url');

var _documentCurrentScript = typeof document !== 'undefined' ? document.currentScript : null;
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
 * @returns {string}
 */
function buildRestrictExample(auditedRows, actionRepo) {
  if (!auditedRows || auditedRows.length === 0) return "";

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
  yaml += `  uses: ${actionRepo}/setup@v2\n`;
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

const __dirname$1 = node_path.dirname(node_url.fileURLToPath((typeof document === 'undefined' ? require('u' + 'rl').pathToFileURL(__filename).href : (_documentCurrentScript && _documentCurrentScript.tagName.toUpperCase() === 'SCRIPT' && _documentCurrentScript.src || new URL('index.js', document.baseURI).href))));

// 1. Get structured report from container via QuickJS
const composeFile = process.argv[2] || node_path.join(__dirname$1, "../..", "setup", "compose.yml");
const composeEnv = {
  ...process.env,
  BUILDER_NAME: process.env.INPUT_BUILDER_NAME || "buildcage",
};

let jsonOutput;
try {
  jsonOutput = node_child_process.execFileSync(
    "docker",
    ["compose", "-f", composeFile, "exec", "builder", "qjs", "/opt/buildcage/tools/report.mjs"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: composeEnv }
  );
} catch (e) {
  console.log("Failed to get report from container:", e.message);
  process.exit(1);
}

const report = JSON.parse(jsonOutput);

// 2. Console output — raw log lines (read directly from container log file)
console.log("::group::HTTP Proxy communication logs");
try {
  const rawLog = node_child_process.execFileSync(
    "docker",
    ["compose", "-f", composeFile, "exec", "builder", "cat", "/var/log/haproxy/current"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: composeEnv }
  );
  process.stdout.write(rawLog);
} catch {
  console.log("(failed to read raw log)");
}
console.log("::endgroup::");
console.log();

// 3. Build summary
if (report.mode === null) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    node_fs.appendFileSync(summaryFile, "No proxy logs found.\n");
  }
  console.log("No proxy logs found.");
  process.exit(0);
}

function markdownTable(rows, { showReason = false } = {}) {
  if (showReason) {
    const lines = ["| Host | Rule | Reason | Count |", "| --- | --- | --- | ---: |"];
    for (const r of rows) {
      lines.push(`| ${r.host}:${r.port} | ${r.ruleType} | ${r.reason} | ${r.count} |`);
    }
    return lines.join("\n");
  }
  const lines = ["| Host | Rule | Count |", "| --- | --- | ---: |"];
  for (const r of rows) {
    lines.push(`| ${r.host}:${r.port} | ${r.ruleType} | ${r.count} |`);
  }
  return lines.join("\n");
}

const actionRepo = process.env.GITHUB_ACTION_REPOSITORY || "dash14/buildcage";
const isAudit = report.mode === "audit";
let markdown = `## Outbound Traffic Report during Docker Build (${report.mode} mode)\n\n`;

if (isAudit) {
  const audited = report.sections.audited || [];
  if (audited.length > 0) {
    markdown += "### 📋 Audited Hosts\n\n" + markdownTable(audited) + "\n";
  }
  markdown += buildRestrictExample(audited, actionRepo);
  const blocked = report.sections.blocked || [];
  if (blocked.length > 0) {
    if (audited.length > 0) markdown += "\n";
    markdown += "### 🚫 Blocked Hosts\n\n" + markdownTable(blocked, { showReason: true }) + "\n";
  }
} else {
  const allowed = report.sections.allowed || [];
  const blocked = report.sections.blocked || [];
  if (allowed.length > 0) {
    markdown += "### ✅ Allowed Hosts\n\n" + markdownTable(allowed) + "\n";
  }
  if (allowed.length > 0 && blocked.length > 0) {
    markdown += "\n";
  }
  if (blocked.length > 0) {
    markdown += "### 🚫 Blocked Hosts\n\n" + markdownTable(blocked, { showReason: true }) + "\n";
  }
}

markdown += "\n<sub>*Note: HTTP rules are based on the Host header, HTTPS rules on SNI, and IP rules on the destination IP address.*</sub>\n";

markdown += `\n*Reported by [Buildcage](https://github.com/${actionRepo})*\n`;

// Write Job Summary
const summaryFile = process.env.GITHUB_STEP_SUMMARY;
if (summaryFile) {
  node_fs.appendFileSync(summaryFile, markdown);
} else {
  console.log(markdown);
}

// 4. Error control for blocked connections
if (report.blockedCount > 0) {
  if (isAudit) {
    console.log(
      `::notice::${report.blockedCount} blocked connection(s) detected by buildcage proxy`
    );
  } else {
    const failOnBlocked =
      (process.env.INPUT_FAIL_ON_BLOCKED || "true").toLowerCase() === "true";
    if (failOnBlocked) {
      console.log(
        `::error::${report.blockedCount} blocked connection(s) detected by buildcage proxy`
      );
      process.exitCode = 1;
    } else {
      console.log(
        `::notice::${report.blockedCount} blocked connection(s) detected by buildcage proxy`
      );
    }
  }
}

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRestrictExample } from "./lib/build-example.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 1. Get structured report from container via QuickJS
const composeFile = process.argv[2] || join(__dirname, "..", "setup", "compose.yml");
const composeEnv = {
  ...process.env,
  BUILDER_NAME: process.env.INPUT_BUILDER_NAME || "buildcage",
};

let jsonOutput;
try {
  jsonOutput = execFileSync(
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
  const rawLog = execFileSync(
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
    appendFileSync(summaryFile, "No proxy logs found.\n");
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
  appendFileSync(summaryFile, markdown);
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

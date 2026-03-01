import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 1. Fetch proxy logs
const composeFile = process.argv[2] || join(__dirname, "..", "setup", "compose.yml");
const logs = execFileSync(
  "docker",
  ["compose", "-f", composeFile, "logs", "--no-log-prefix", "builder"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
);

// 2. Console output
console.log("::group::HTTP Proxy communication logs");
for (const line of logs.split("\n")) {
  if (line.startsWith("[")) console.log(line);
}
console.log("::endgroup::");
console.log();

// 3. Parse log lines
const logPattern =
  /^\[.*?\]\s+buildcage\s+\[(AUDIT|ALLOWED|BLOCKED)\]\s+"([^"]+)"\s*(\S*)/;

const entries = [];
for (const line of logs.split("\n")) {
  const m = line.match(logPattern);
  if (m) {
    const hostPort = m[2];
    const reason = m[3] || "-";
    const colonIdx = hostPort.lastIndexOf(":");
    let host, port;
    if (colonIdx > 0) {
      host = hostPort.substring(0, colonIdx);
      port = hostPort.substring(colonIdx + 1);
    } else {
      host = hostPort;
      port = 0;
    }
    entries.push({
      decision: m[1],
      host,
      port,
      reason,
    });
  }
}

// 4. Detect mode and build summary
if (entries.length === 0) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    appendFileSync(summaryFile, "No proxy logs found.\n");
  }
  console.log("No proxy logs found.");
  process.exit(0);
}

const isAudit = entries.some((e) => e.decision === "AUDIT");

// Aggregate by (host, port, reason) → count, sorted descending
function aggregate(filtered) {
  const map = new Map();
  for (const e of filtered) {
    const key = `${e.host}\t${e.port}\t${e.reason}`;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()]
    .map(([key, count]) => {
      const [host, portStr, reason] = key.split("\t");
      return { host, port: Number(portStr), reason, count };
    })
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.host.localeCompare(b.host) ||
        a.port - b.port
    );
}

function markdownTable(rows, { showReason = false } = {}) {
  if (showReason) {
    const lines = ["| Host | Port | Reason | Count |", "| --- | --- | --- | ---: |"];
    for (const r of rows) {
      lines.push(`| ${r.host} | ${r.port || ""} | ${r.reason} | ${r.count} |`);
    }
    return lines.join("\n");
  }
  const lines = ["| Host | Port | Count |", "| --- | --- | ---: |"];
  for (const r of rows) {
    lines.push(`| ${r.host} | ${r.port || ""} | ${r.count} |`);
  }
  return lines.join("\n");
}

const mode = isAudit ? "audit" : "restrict";
let markdown = `## Outbound Traffic Report during Docker Build (${mode} mode)\n\n`;

if (isAudit) {
  const audited = aggregate(entries.filter((e) => e.decision === "AUDIT"));
  if (audited.length > 0) {
    markdown += "### 📋 Audited Hosts\n\n" + markdownTable(audited) + "\n";
  }
  const blocked = aggregate(entries.filter((e) => e.decision === "BLOCKED"));
  if (blocked.length > 0) {
    if (audited.length > 0) markdown += "\n";
    markdown += "### 🚫 Blocked Hosts\n\n" + markdownTable(blocked, { showReason: true }) + "\n";
  }
} else {
  const allowed = aggregate(entries.filter((e) => e.decision === "ALLOWED"));
  const blocked = aggregate(entries.filter((e) => e.decision === "BLOCKED"));
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

const actionRepo = process.env.GITHUB_ACTION_REPOSITORY || "dash14/buildcage";
markdown += `\n*Reported by [buildcage](https://github.com/${actionRepo})*\n`;

// Write Job Summary
const summaryFile = process.env.GITHUB_STEP_SUMMARY;
if (summaryFile) {
  appendFileSync(summaryFile, markdown);
} else {
  console.log(markdown);
}

// 5. Error control for blocked connections
const blockedCount = entries.filter((e) => e.decision === "BLOCKED").length;
if (blockedCount > 0) {
  if (isAudit) {
    console.log(
      `::notice::${blockedCount} blocked connection(s) detected by buildcage proxy`
    );
  } else {
    const failOnBlocked =
      (process.env.INPUT_FAIL_ON_BLOCKED || "true").toLowerCase() === "true";
    if (failOnBlocked) {
      console.log(
        `::error::${blockedCount} blocked connection(s) detected by buildcage proxy`
      );
      process.exitCode = 1;
    } else {
      console.log(
        `::notice::${blockedCount} blocked connection(s) detected by buildcage proxy`
      );
    }
  }
}

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRestrictExample } from "./lib/build-example.js";
import { renderCommunicationDetails } from "./lib/command-log.js";
import { selectAllRefs, parseVertexAllowedLog, aggregateAllowedHosts } from "./lib/vertex-log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 1. Get structured report from container via QuickJS
const composeFile = process.argv[2] || join(__dirname, "../..", "setup", "compose.yaml");
const composeEnv = {
  ...process.env,
  BUILDER_NAME: process.env.INPUT_BUILDER_NAME || "buildcage",
};

let jsonOutput;
try {
  // Works unmodified against either engine without needing to know which one
  // is running, same as the raw-log step below: try transparent's report.js,
  // then explicit's.
  jsonOutput = execFileSync(
    "docker",
    [
      "compose", "-f", composeFile, "exec", "builder", "sh", "-c",
      "qjs -m /opt/buildcage/tools/transparent/report.js 2>/dev/null || qjs -m /opt/buildcage/tools/explicit/report.js",
    ],
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
  // Explicit proxy engine writes its log to /var/log/buildkitd/current instead
  // of HAProxy's /var/log/haproxy/current; try that first and fall back so
  // this works unmodified against either engine without needing to know
  // which one is running.
  const rawLog = execFileSync(
    "docker",
    [
      "compose", "-f", composeFile, "exec", "builder", "sh", "-c",
      "cat /var/log/buildkitd/current 2>/dev/null || cat /var/log/haproxy/current 2>/dev/null",
    ],
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

// report.deniedTimeline is only present in explicit engine's report.js output
// (see docker/tools/explicit/report.js) — transparent mode has neither this
// nor a per-command breakdown to offer at all (its ACL log has no per-command
// boundary), so `isExplicit` gates both the allowed/audited table's source
// below and the Communication details section further down.
const isExplicit = report.deniedTimeline !== undefined;

// Fetched once, up front, since it feeds both the allowed/audited table
// (via aggregateAllowedHosts) and the per-command Communication details
// section (via renderCommunicationDetails) below. Explicit mode's own
// report.js has no "allowed"/"audited" section — that data comes from
// buildctl's build-history vertex log instead, which needs no special
// buildkitd configuration and tags each entry with the RUN step (vertex)
// that produced it (see report/src/lib/vertex-log.js).
let builds = [];
if (isExplicit) {
  try {
    const historiesOutput = execFileSync(
      "docker",
      ["compose", "-f", composeFile, "exec", "builder", "buildctl", "debug", "histories", "--format", "{{json .}}"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: composeEnv }
    );
    // Every build since the container started, not just the latest one — a
    // workflow may run several builds against the same buildcage container
    // before calling this action once, and each is its own independent
    // buildctl history record (see vertex-log.js's selectAllRefs()).
    const refs = selectAllRefs(historiesOutput);
    builds = refs.map((ref) => {
      const rawJsonOutput = execFileSync(
        "docker",
        ["compose", "-f", composeFile, "exec", "builder", "buildctl", "debug", "logs", "--progress=rawjson", ref],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: composeEnv, maxBuffer: 64 * 1024 * 1024 }
      );
      return parseVertexAllowedLog(rawJsonOutput);
    });
  } catch (e) {
    console.log("(failed to fetch allowed/audited traffic detail via buildctl:", e.message, ")");
  }
}

let markdown = `## Outbound Traffic Report during Docker Build (${report.mode} mode)\n\n`;

if (isAudit) {
  const audited = isExplicit ? aggregateAllowedHosts(builds, "AUDIT") : report.sections.audited || [];
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
  const allowed = isExplicit ? aggregateAllowedHosts(builds, "ALLOWED") : report.sections.allowed || [];
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

if (isExplicit) {
  markdown += renderCommunicationDetails(builds, report.deniedTimeline);
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

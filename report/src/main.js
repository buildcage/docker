import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRestrictExample } from "../../core/lib/build-example.js";
import { renderCommunicationDetails } from "./lib/command-log.js";
import { selectAllRefs, parseVertexAllowedLog, aggregateAllowedHosts } from "./lib/vertex-log.js";
import { createAnnotation } from "../../core/lib/annotation.js";
import { parseKnownBlockedRules, annotateKnownBlocked, determineBlockedOutcome, buildBlockedMessage } from "../../core/lib/known-blocked.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 1. Get structured report from container via QuickJS
const composeFile = process.argv[2] || join(__dirname, "../..", "setup", "compose.yaml");
// "buildcage" here is a fallback for running outside the Actions runtime
// (action.yml's own `default: 'buildcage'` covers the normal case) — keep
// both, and setup/src/main.js's copy, in sync.
const composeEnv = {
  ...process.env,
  BUILDER_NAME: process.env.INPUT_BUILDER_NAME || "buildcage",
};

let knownBlockedRules;
try {
  knownBlockedRules = parseKnownBlockedRules(process.env.INPUT_KNOWN_BLOCKED_RULES);
} catch (e) {
  console.log(`::error::${e.message}`);
  process.exit(1);
}

let jsonOutput;
try {
  jsonOutput = execFileSync(
    "docker",
    [
      "compose", "-f", composeFile, "exec", "builder", "sh", "-c",
      "qjs -m /opt/buildcage/scripts/report.js",
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

function markdownTable(rows, { showReason = false, showExpected = false } = {}) {
  const headers = ["Host", "Rule"];
  const aligns = ["---", "---"];
  if (showReason) { headers.push("Reason"); aligns.push("---"); }
  headers.push("Count"); aligns.push("---:");
  if (showExpected) { headers.push("Expected"); aligns.push(":---:"); }

  const lines = [`| ${headers.join(" | ")} |`, `| ${aligns.join(" | ")} |`];
  for (const r of rows) {
    const cells = [`${r.host}:${r.port}`, r.ruleType];
    if (showReason) cells.push(r.reason);
    cells.push(r.count);
    if (showExpected) cells.push(r.expected ? "✅" : "");
    lines.push(`| ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}

const actionRepo = process.env.GITHUB_ACTION_REPOSITORY || "dash14/buildcage";
const actionRef = process.env.GITHUB_ACTION_REF || "v2";
const isAudit = report.mode === "audit";

// report.deniedTimeline is only present in explicit engine's report.js output
// (see setup/docker/explicit/scripts/report.js) — transparent mode has neither this
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

const blocked = report.sections.blocked || [];
const annotatedBlocked = annotateKnownBlocked(blocked, knownBlockedRules);
const showExpected = knownBlockedRules.length > 0;

if (isAudit) {
  const audited = isExplicit ? aggregateAllowedHosts(builds, "AUDIT") : report.sections.audited || [];
  if (audited.length > 0) {
    markdown += "### 📋 Audited Hosts\n\n" + markdownTable(audited) + "\n";
  }
  markdown += buildRestrictExample(audited, actionRepo, actionRef);
  if (blocked.length > 0) {
    if (audited.length > 0) markdown += "\n";
    markdown += "### 🚫 Blocked Hosts\n\n" + markdownTable(annotatedBlocked, { showReason: true, showExpected }) + "\n";
  }
} else {
  const allowed = isExplicit ? aggregateAllowedHosts(builds, "ALLOWED") : report.sections.allowed || [];
  if (allowed.length > 0) {
    markdown += "### ✅ Allowed Hosts\n\n" + markdownTable(allowed) + "\n";
  }
  if (allowed.length > 0 && blocked.length > 0) {
    markdown += "\n";
  }
  if (blocked.length > 0) {
    markdown += "### 🚫 Blocked Hosts\n\n" + markdownTable(annotatedBlocked, { showReason: true, showExpected }) + "\n";
  }
}

if (isExplicit) {
  markdown += renderCommunicationDetails(builds, report.deniedTimeline);
}

// SNI-based sniffing only applies to the transparent engine — the explicit
// engine terminates TLS itself, so this caveat doesn't apply to it.
if (!isExplicit) {
  markdown += "\n<sub>*Note: HTTP rules are based on the Host header, HTTPS rules on SNI, and IP rules on the destination IP address.*</sub>\n";
}

markdown += `\n*Reported by [Buildcage](https://github.com/${actionRepo})*\n`;

// Write Job Summary
const summaryFile = process.env.GITHUB_STEP_SUMMARY;
if (summaryFile) {
  appendFileSync(summaryFile, markdown);
} else {
  console.log(markdown);
}

// 4. Error control for blocked connections
const outputForAction = Boolean(summaryFile);
const annotation = createAnnotation(outputForAction);
const failOnBlocked = (process.env.INPUT_FAIL_ON_BLOCKED || "true").toLowerCase() === "true";
const outcome = determineBlockedOutcome({ isAudit, failOnBlocked, blockedCount: report.blockedCount, blockedRows: annotatedBlocked });
if (outcome.level !== "none") {
  const message = buildBlockedMessage({
    blockedCount: report.blockedCount,
    blockedRows: annotatedBlocked,
    knownBlockedRulesUsed: knownBlockedRules.length > 0,
    engineLabel: "proxy",
  });
  if (outcome.level === "error") {
    annotation.error(message);
    process.exitCode = 1;
  } else {
    annotation.notice(message);
  }
}

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { createAnnotation } from "../../../core/lib/annotation.js";
import { buildRestrictExample } from "../../../core/lib/build-example.js";
import { annotateKnownBlocked, determineBlockedOutcome, buildBlockedMessage } from "../../../core/lib/known-blocked.js";

/**
 * Fetch the structured HAProxy-log report from the (still-running) proxy
 * container. Unlike report/src/main.js (which supports both engines), the
 * run action always runs the transparent-engine proxy stack, so this
 * only ever needs core/scripts/report.js.
 */
export function fetchReport(containerName) {
  const jsonOutput = execFileSync(
    "docker",
    ["exec", containerName, "qjs", "-m", "/opt/buildcage/scripts/report.js"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return JSON.parse(jsonOutput);
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

/**
 * Build the Job Summary markdown section for this run step's traffic
 * report. Each `run` step gets its own section (rather than one report
 * per job), matching the "one proxy container per step" execution model.
 */
export function buildReportMarkdown(report, { stepLabel, actionRepo, actionRef, runCommand, knownBlockedRules = [] } = {}) {
  // Mirrors report/src/main.js's "## Outbound Traffic Report during Docker
  // Build (mode)" heading, so both actions read as the same kind of report.
  const heading = `Outbound Traffic Report${stepLabel ? ` — ${stepLabel}` : ""}`;
  if (report.mode === null) {
    return `## ${heading}\n\nNo proxy logs found.\n`;
  }

  const isAudit = report.mode === "audit";
  let markdown = `## ${heading} (${report.mode} mode)\n\n`;

  const blocked = report.sections.blocked || [];
  const annotatedBlocked = annotateKnownBlocked(blocked, knownBlockedRules);
  const showExpected = knownBlockedRules.length > 0;

  if (isAudit) {
    const audited = report.sections.audited || [];
    if (audited.length > 0) markdown += "### 📋 Audited Hosts\n\n" + markdownTable(audited) + "\n\n";
    markdown += buildRestrictExample(audited, actionRepo, actionRef, { actionName: "run", runCommand });
    if (blocked.length > 0) markdown += "### 🚫 Blocked Hosts\n\n" + markdownTable(annotatedBlocked, { showReason: true, showExpected }) + "\n\n";
  } else {
    const allowed = report.sections.allowed || [];
    if (allowed.length > 0) markdown += "### ✅ Allowed Hosts\n\n" + markdownTable(allowed) + "\n\n";
    if (blocked.length > 0) markdown += "### 🚫 Blocked Hosts\n\n" + markdownTable(annotatedBlocked, { showReason: true, showExpected }) + "\n\n";
  }

  return markdown;
}

/**
 * Append this step's report to the Job Summary and emit annotations /
 * set the exit code for blocked connections, mirroring report/src/main.js's
 * behavior but scoped to a single run step's proxy container.
 */
export function writeReport(report, { stepLabel, failOnBlocked, actionRepo, actionRef, runCommand, knownBlockedRules = [] } = {}) {
  const markdown = buildReportMarkdown(report, { stepLabel, actionRepo, actionRef, runCommand, knownBlockedRules });
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    appendFileSync(summaryFile, markdown);
  } else {
    console.log(markdown);
  }

  // Debug-only mirror: GITHUB_STEP_SUMMARY is unique per step and can't be
  // overridden (GitHub ignores attempts to reassign GITHUB_*/RUNNER_* env
  // vars), so a later step has no way to read this step's copy back. When
  // set, also append to this second, stable path so a later step can
  // inspect what was written.
  const debugSummaryFile = process.env.BUILDCAGE_RUN_DEBUG_SUMMARY_FILE;
  if (debugSummaryFile) {
    appendFileSync(debugSummaryFile, markdown);
  }

  const annotation = createAnnotation(Boolean(summaryFile));
  const blockedRows = annotateKnownBlocked(report.sections?.blocked || [], knownBlockedRules);
  const outcome = determineBlockedOutcome({
    isAudit: report.mode === "audit",
    failOnBlocked,
    blockedCount: report.blockedCount ?? 0,
    blockedRows,
  });
  if (outcome.level !== "none") {
    const message = buildBlockedMessage({
      blockedCount: report.blockedCount,
      blockedRows,
      knownBlockedRulesUsed: knownBlockedRules.length > 0,
      engineLabel: "sandbox",
    });
    if (outcome.level === "error") {
      annotation.error(message);
      process.exitCode = 1;
    } else {
      annotation.notice(message);
    }
  }
}

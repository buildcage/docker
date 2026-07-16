import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { createAnnotation } from "../../../report/src/lib/annotation.js";

/**
 * Fetch the structured HAProxy-log report from the (still-running) proxy
 * container. Unlike report/src/main.js (which supports both engines), the
 * sandbox action always runs the transparent-engine proxy stack, so this
 * only ever needs docker/tools/transparent/report.js.
 */
export function fetchReport(containerName) {
  const jsonOutput = execFileSync(
    "docker",
    ["exec", containerName, "qjs", "-m", "/opt/buildcage/tools/transparent/report.js"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return JSON.parse(jsonOutput);
}

function markdownTable(rows, { showReason = false } = {}) {
  if (showReason) {
    const lines = ["| Host | Rule | Reason | Count |", "| --- | --- | --- | ---: |"];
    for (const r of rows) lines.push(`| ${r.host}:${r.port} | ${r.ruleType} | ${r.reason} | ${r.count} |`);
    return lines.join("\n");
  }
  const lines = ["| Host | Rule | Count |", "| --- | --- | ---: |"];
  for (const r of rows) lines.push(`| ${r.host}:${r.port} | ${r.ruleType} | ${r.count} |`);
  return lines.join("\n");
}

/**
 * Build the Job Summary markdown section for this sandbox step's traffic
 * report. Each `sandbox` step gets its own section (rather than one report
 * per job), matching the "one proxy container per step" execution model.
 */
export function buildReportMarkdown(report, { stepLabel } = {}) {
  if (report.mode === null) {
    return `### 🧰 Sandbox${stepLabel ? ` — ${stepLabel}` : ""}\n\nNo proxy logs found.\n`;
  }

  const isAudit = report.mode === "audit";
  let markdown = `### 🧰 Sandbox${stepLabel ? ` — ${stepLabel}` : ""} (${report.mode} mode)\n\n`;

  if (isAudit) {
    const audited = report.sections.audited || [];
    if (audited.length > 0) markdown += "**📋 Audited Hosts**\n\n" + markdownTable(audited) + "\n\n";
    const blocked = report.sections.blocked || [];
    if (blocked.length > 0) markdown += "**🚫 Blocked Hosts**\n\n" + markdownTable(blocked, { showReason: true }) + "\n\n";
  } else {
    const allowed = report.sections.allowed || [];
    if (allowed.length > 0) markdown += "**✅ Allowed Hosts**\n\n" + markdownTable(allowed) + "\n\n";
    const blocked = report.sections.blocked || [];
    if (blocked.length > 0) markdown += "**🚫 Blocked Hosts**\n\n" + markdownTable(blocked, { showReason: true }) + "\n\n";
  }

  return markdown;
}

/**
 * Append this step's report to the Job Summary and emit annotations /
 * set the exit code for blocked connections, mirroring report/src/main.js's
 * behavior but scoped to a single sandbox step's proxy container.
 */
export function writeReport(report, { stepLabel, failOnBlocked } = {}) {
  const markdown = buildReportMarkdown(report, { stepLabel });
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
  const debugSummaryFile = process.env.BUILDCAGE_SANDBOX_DEBUG_SUMMARY_FILE;
  if (debugSummaryFile) {
    appendFileSync(debugSummaryFile, markdown);
  }

  const annotation = createAnnotation(Boolean(summaryFile));
  if (report.blockedCount > 0) {
    const isAudit = report.mode === "audit";
    const message = `${report.blockedCount} blocked connection(s) detected by buildcage sandbox`;
    if (isAudit || !failOnBlocked) {
      annotation.notice(message);
    } else {
      annotation.error(message);
      process.exitCode = 1;
    }
  }
}

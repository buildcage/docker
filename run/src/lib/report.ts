import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { createAnnotation } from "../../../core/lib/actions/annotation.ts";
import { buildRestrictExample } from "../../../core/lib/report/build-example.ts";
import { evaluateBlockedReport, type AnnotatedBlockedRow, type BlockedRow } from "../../../core/lib/report/known-blocked.ts";
import { renderHostTable, type HostTableRow } from "../../../core/lib/report/host-table.ts";

export interface Report {
  mode: string | null;
  sections?: {
    audited?: HostTableRow[];
    allowed?: HostTableRow[];
    blocked?: BlockedRow[];
  };
  blockedCount?: number;
}

/**
 * Fetch the structured HAProxy-log report from the (still-running) proxy
 * container. Unlike report/src/main.js (which supports both engines), the
 * run action always runs the transparent-engine proxy stack, so this
 * only ever needs core/scripts/report.js.
 */
export function fetchReport(containerName: string): Report {
  const jsonOutput = execFileSync(
    "docker",
    ["exec", containerName, "qjs", "-m", "/opt/buildcage/scripts/report.js"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return JSON.parse(jsonOutput);
}

/**
 * Build the Job Summary markdown section for this run step's traffic
 * report. Each `run` step gets its own section (rather than one report
 * per job), matching the "one proxy container per step" execution model.
 *
 * `blockedRows`/`showExpected` come pre-computed from the caller so
 * known_blocked_rules matching runs once per report, not once per render.
 */
export function buildReportMarkdown(
  report: Report,
  {
    stepLabel,
    actionRepo,
    actionRef,
    runCommand,
    blockedRows = [],
    showExpected = false,
  }: {
    stepLabel?: string;
    actionRepo?: string;
    actionRef?: string;
    runCommand?: string;
    blockedRows?: AnnotatedBlockedRow[];
    showExpected?: boolean;
  } = {},
): string {
  // Mirrors report/src/main.js's "## Outbound Traffic Report during Docker
  // Build (mode)" heading, so both actions read as the same kind of report.
  const heading = `Outbound Traffic Report${stepLabel ? ` — ${stepLabel}` : ""}`;
  if (report.mode === null) {
    return `## ${heading}\n\nNo proxy logs found.\n`;
  }

  const isAudit = report.mode === "audit";
  let markdown = `## ${heading} (${report.mode} mode)\n\n`;

  if (isAudit) {
    const audited = report.sections?.audited || [];
    if (audited.length > 0) markdown += "### 📋 Audited Hosts\n\n" + renderHostTable(audited) + "\n\n";
    markdown += buildRestrictExample(audited, actionRepo!, actionRef, { actionName: "run", runCommand });
    if (blockedRows.length > 0) markdown += "### 🚫 Blocked Hosts\n\n" + renderHostTable(blockedRows, { showReason: true, showExpected }) + "\n\n";
  } else {
    const allowed = report.sections?.allowed || [];
    if (allowed.length > 0) markdown += "### ✅ Allowed Hosts\n\n" + renderHostTable(allowed) + "\n\n";
    if (blockedRows.length > 0) markdown += "### 🚫 Blocked Hosts\n\n" + renderHostTable(blockedRows, { showReason: true, showExpected }) + "\n\n";
  }

  return markdown;
}

/**
 * Append this step's report to the Job Summary and emit annotations /
 * set the exit code for blocked connections, mirroring report/src/main.js's
 * behavior but scoped to a single run step's proxy container.
 */
export interface WriteReportOptions {
  stepLabel?: string;
  failOnBlocked?: boolean;
  actionRepo?: string;
  actionRef?: string;
  runCommand?: string;
  knownBlockedRules?: string[];
}

export function writeReport(
  report: Report,
  { stepLabel, failOnBlocked, actionRepo, actionRef, runCommand, knownBlockedRules = [] }: WriteReportOptions = {},
): void {
  const { blockedRows, showExpected, outcome, message } = evaluateBlockedReport(report, {
    knownBlockedRules, failOnBlocked: failOnBlocked ?? false, engineLabel: "sandbox",
  });

  const markdown = buildReportMarkdown(report, { stepLabel, actionRepo, actionRef, runCommand, blockedRows, showExpected });
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
  if (outcome.level === "error") {
    annotation.error(message!);
    process.exitCode = 1;
  } else if (outcome.level === "notice") {
    annotation.notice(message!);
  }
}

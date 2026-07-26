import { appendFileSync } from "node:fs";
import { createDocker } from "../../../core/lib/docker/client.ts";
import { createAnnotation } from "../../../core/lib/actions/annotation.ts";
import { buildRestrictExample } from "../../../core/lib/report/build-example.ts";
import { determineBlockedOutcome, buildBlockedMessage } from "../../../core/lib/report/known-blocked.ts";
import { renderHostTable } from "../../../core/lib/report/host-table.ts";
import { buildTransparentReportData } from "../../../core/lib/report/build-transparent-report-data.ts";
import type { GenReportParameters, TransparentReportData } from "../../../core/lib/report/report-data.ts";

export type Report = TransparentReportData;

const LOG_FILE = "/var/log/haproxy/current";

/**
 * Fetch the report from the (still-running) sandbox proxy container. run
 * always runs the transparent-engine proxy stack (never explicit), and —
 * unlike report/src/main.ts, whose report-action.js is version-matched to
 * whatever setup started — has no version-skew concern of its own (this
 * whole action, from starting the container to reporting on it, runs at
 * one pinned version), so it fetches the raw log itself and calls the
 * same shared builder function report-action.js uses, in-process, instead
 * of shelling out to a qjs script.
 */
export function fetchReport(containerName: string, parameters: GenReportParameters): Report {
  const logText = createDocker().readFile(containerName, LOG_FILE);
  return buildTransparentReportData(logText, parameters);
}

/**
 * Fields shared by buildReportMarkdown/writeReport's option bags — both
 * describe the same run step (label, provenance-example context).
 */
export interface ReportRenderContext {
  stepLabel?: string;
  actionRepo?: string;
  actionRef?: string;
  runCommand?: string;
}

/**
 * Build the Job Summary markdown section for this run step's traffic
 * report. Each `run` step gets its own section (rather than one report
 * per job), matching the "one proxy container per step" execution model.
 */
export function buildReportMarkdown(
  report: Report,
  { stepLabel, actionRepo, actionRef, runCommand }: ReportRenderContext = {},
): string {
  // Mirrors report/src/main.ts's "## Outbound Traffic Report during Docker
  // Build (mode)" heading, so both actions read as the same kind of report.
  const heading = `Outbound Traffic Report${stepLabel ? ` — ${stepLabel}` : ""}`;
  const isAudit = report.parameters.mode === "audit";
  const showExpected = report.parameters.knownBlockedRules.length > 0;
  let markdown = `## ${heading} (${report.parameters.mode} mode)\n\n`;

  if (isAudit) {
    if (report.passed.length > 0) markdown += "### 📋 Audited Hosts\n\n" + renderHostTable(report.passed) + "\n\n";
    if (actionRepo) {
      markdown += buildRestrictExample(report.passed, actionRepo, actionRef, { actionName: "run", runCommand });
    }
    if (report.blocked.length > 0) markdown += "### 🚫 Blocked Hosts\n\n" + renderHostTable(report.blocked, { showReason: true, showExpected }) + "\n\n";
  } else {
    if (report.passed.length > 0) markdown += "### ✅ Allowed Hosts\n\n" + renderHostTable(report.passed) + "\n\n";
    if (report.blocked.length > 0) markdown += "### 🚫 Blocked Hosts\n\n" + renderHostTable(report.blocked, { showReason: true, showExpected }) + "\n\n";
  }

  return markdown;
}

/**
 * Append this step's report to the Job Summary and emit annotations /
 * set the exit code for blocked connections, mirroring report-action.js's
 * behavior but scoped to a single run step's proxy container.
 */
export interface WriteReportOptions extends ReportRenderContext {
  failOnBlocked?: boolean;
}

export function writeReport(
  report: Report,
  { stepLabel, failOnBlocked, actionRepo, actionRef, runCommand }: WriteReportOptions = {},
): void {
  const isAudit = report.parameters.mode === "audit";
  const outcome = determineBlockedOutcome({
    isAudit,
    failOnBlocked: failOnBlocked ?? false,
    blockedCount: report.blockedCount,
    blockedRows: report.blocked,
  });
  const message = buildBlockedMessage({
    blockedCount: report.blockedCount,
    blockedRows: report.blocked,
    engineLabel: "sandbox",
    isAudit,
  });

  const markdown = buildReportMarkdown(report, { stepLabel, actionRepo, actionRef, runCommand });
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
    annotation.error(message);
    process.exitCode = 1;
  } else if (outcome.level === "notice") {
    annotation.notice(message);
  }
}

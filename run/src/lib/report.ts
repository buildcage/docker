import { appendFileSync } from "node:fs";
import { createDocker } from "../../../core/lib/docker/client.ts";
import { createAnnotation } from "../../../core/lib/actions/annotation.ts";
import { buildRestrictExample } from "../../../core/lib/report/build-example.ts";
import {
  determineBlockedOutcome,
  buildBlockedMessage,
} from "../../../core/lib/report/known-blocked.ts";
import { renderHostTable } from "../../../core/lib/report/host-table.ts";
import { buildTransparentReportData } from "../../../core/lib/report/build-transparent-report-data.ts";
import type {
  GenReportParameters,
  TransparentReportData,
} from "../../../core/lib/report/report-data.ts";

export type Report = TransparentReportData;

const LOG_FILE = "/var/log/haproxy/current";

/**
 * run always runs the transparent-engine stack and, unlike report/src/main.ts,
 * has no version-skew concern of its own (one pinned version end to end),
 * so it fetches the raw log and calls the shared builder in-process.
 */
export function fetchReport(
  containerName: string,
  parameters: GenReportParameters,
): Promise<Report> {
  return buildTransparentReportData(
    createDocker().readFileLines(containerName, LOG_FILE),
    parameters,
  );
}

export interface ReportRenderContext {
  stepLabel?: string;
  actionRepo?: string;
  actionRef?: string;
  runCommand?: string;
}

export function buildReportMarkdown(
  report: Report,
  { stepLabel, actionRepo, actionRef, runCommand }: ReportRenderContext = {},
): string {
  // Mirrors report/src/main.ts's heading, so both actions read alike.
  const heading = `Outbound Traffic Report${stepLabel ? ` — ${stepLabel}` : ""}`;
  const isAudit = report.parameters.mode === "audit";
  const showExpected = report.parameters.knownBlockedRules.length > 0;
  let markdown = `## ${heading} (${report.parameters.mode} mode)\n\n`;

  if (isAudit) {
    if (report.passed.length > 0)
      markdown += "### 📋 Audited Hosts\n\n" + renderHostTable(report.passed) + "\n\n";
    if (actionRepo) {
      markdown += buildRestrictExample(report.passed, actionRepo, actionRef, {
        actionName: "run",
        runCommand,
      });
    }
    if (report.blocked.length > 0)
      markdown +=
        "### 🚫 Blocked Hosts\n\n" +
        renderHostTable(report.blocked, { showReason: true, showExpected }) +
        "\n\n";
  } else {
    if (report.passed.length > 0)
      markdown += "### ✅ Allowed Hosts\n\n" + renderHostTable(report.passed) + "\n\n";
    if (report.blocked.length > 0)
      markdown +=
        "### 🚫 Blocked Hosts\n\n" +
        renderHostTable(report.blocked, { showReason: true, showExpected }) +
        "\n\n";
  }

  return markdown;
}

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
    logLooksPlausible: report.logLooksPlausible,
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
  // reassigned, so a later step has no way to read this step's copy back.
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

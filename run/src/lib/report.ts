import { createDocker } from "../../../core/lib/docker/client.ts";
import { buildRestrictExample } from "../../../core/lib/report/build-example.ts";
import { describeBlockedOutcome } from "../../../core/lib/report/known-blocked.ts";
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

export interface ComputeReportOutcomeOptions extends ReportRenderContext {
  failOnBlocked?: boolean;
}

export interface ReportOutcome {
  markdown: string;
  message: string;
  level: "none" | "notice" | "error";
  shouldFail: boolean;
}

/**
 * Pure decision + rendering step, kept free of process.env/file I/O so it's
 * testable without touching the filesystem — see main.ts's writeReportSummary
 * for the side-effecting half (actual summary/annotation output).
 */
export function computeReportOutcome(
  report: Report,
  { stepLabel, failOnBlocked, actionRepo, actionRef, runCommand }: ComputeReportOutcomeOptions = {},
): ReportOutcome {
  const { level, message, shouldFail } = describeBlockedOutcome({
    isAudit: report.parameters.mode === "audit",
    failOnBlocked: failOnBlocked ?? false,
    blockedCount: report.blockedCount,
    blockedRows: report.blocked,
    logLooksPlausible: report.logLooksPlausible,
    engineLabel: "sandbox",
  });
  const markdown = buildReportMarkdown(report, { stepLabel, actionRepo, actionRef, runCommand });

  return { markdown, message, level, shouldFail };
}

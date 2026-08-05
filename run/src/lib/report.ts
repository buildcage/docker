import { createDocker } from "../../../core/lib/docker/client.ts";
import { describeBlockedOutcome } from "../../../core/lib/report/known-blocked.ts";
import { renderReportMarkdown } from "../../../core/lib/report/render-report-markdown.ts";
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

export interface ComputeReportOutcomeOptions {
  stepLabel?: string;
  actionRepo: string;
  actionRef: string;
  runCommand?: string;
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
  { stepLabel, failOnBlocked, actionRepo, actionRef, runCommand }: ComputeReportOutcomeOptions,
): ReportOutcome {
  const { level, message, shouldFail } = describeBlockedOutcome({
    isAudit: report.parameters.mode === "audit",
    failOnBlocked: failOnBlocked ?? false,
    blockedCount: report.blockedCount,
    blockedRows: report.blocked,
    logLooksPlausible: report.logLooksPlausible,
    engineLabel: "sandbox",
  });
  const markdown = renderReportMarkdown(report, actionRepo, actionRef, {
    heading: stepLabel,
    actionName: "run",
    runCommand,
  });

  return { markdown, message, level, shouldFail };
}

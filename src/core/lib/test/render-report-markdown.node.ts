import { joinSummaryBlocks } from "../report/render/fit-step-summary.ts";
import {
  renderReportBlocks,
  TRAFFIC_BLOCK,
  type RenderReportMarkdownOptions,
  type TrafficPriorities,
} from "../report/render/render-report-markdown.ts";
import type { ReportData } from "../report/types.ts";

// Joined whole, the report never compares priorities.
const JOINED = Object.fromEntries(
  Object.values(TRAFFIC_BLOCK).map((id) => [id, 0]),
) as TrafficPriorities;

/**
 * The whole report as one Markdown string, for substring and golden tests that
 * read the output rather than fitting its blocks. Production keeps the blocks
 * apart so fitStepSummary can trim them (see renderReportBlocks); nothing but a
 * test joins them whole.
 */
export function renderReportMarkdown(
  report: ReportData,
  actionRepo: string,
  actionRef: string,
  options: RenderReportMarkdownOptions = {},
): string {
  return joinSummaryBlocks(
    renderReportBlocks(report, actionRepo, actionRef, JOINED, false, options),
  );
}

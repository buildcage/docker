import type { ReportData } from "../types.ts";
import { buildRestrictExample } from "./build-example.ts";
import {
  COMMUNICATION_DETAILS_CLOSE,
  COMMUNICATION_DETAILS_OPEN,
} from "./communication-section.ts";
import { joinSummaryBlocks, type SummaryBlock } from "./fit-step-summary.ts";
import { foldExpectedBlockedRows } from "./fold-expected-blocked.ts";
import { renderHostTable } from "./host-table.ts";
import { renderInspectDetailsBody } from "./inspect-details.ts";
import { buildInspectRestrictExample } from "./inspect-example.ts";
import { escapeCell } from "./markdown-table.ts";
import type { ExampleStepOptions } from "./restrict-example.ts";

export interface RenderReportMarkdownOptions extends ExampleStepOptions {
  /** Heading text. May carry untrusted input: the heading escapes it. */
  title?: string;
}

/** Branches on `report.engine`/`report.parameters.mode` rather than being
 *  duplicated per engine. actionRepo/actionRef are real values, not
 *  placeholders: this runs on the runner, with process.env available. */
export function renderReportMarkdown(
  report: ReportData,
  actionRepo: string,
  actionRef: string,
  options: RenderReportMarkdownOptions = {},
): string {
  return joinSummaryBlocks(renderReportBlocks(report, actionRepo, actionRef, options));
}

const SECTION = "traffic";

/** The ids renderReportBlocks gives its blocks, for picking their notices. */
export const TRAFFIC_BLOCK = {
  example: "traffic-example",
  blocked: "traffic-blocked",
  failed: "traffic-failed",
  passed: "traffic-passed",
  log: "traffic-log",
} as const;

// A table with the text before and after it, cut row by row: its heading,
// header row and separator stay or the whole table gives way.
function tableBlock(
  id: string,
  priority: number,
  before: string,
  table: string,
  after: string,
): SummaryBlock {
  return {
    id,
    priority,
    level: 2,
    section: SECTION,
    text: before + table + after,
    cut: "lines",
    head: before.split("\n").length + 1,
  };
}

const frame = (text: string): SummaryBlock => ({
  priority: 1,
  level: 1,
  section: SECTION,
  text,
  cut: "keep",
});

/**
 * The report as blocks for fitStepSummary, in print order. The frame (title,
 * notes, footer) is kept whole; then the example, the blocked, failed and
 * allowed tables, and the communication details get room in that order, so
 * what explains a failed step outlasts what merely lists traffic. Their
 * notices are the caller's to set, by TRAFFIC_BLOCK id.
 */
export function renderReportBlocks(
  report: ReportData,
  actionRepo: string,
  actionRef: string,
  { title = "Outbound Traffic Report", ...step }: RenderReportMarkdownOptions = {},
): SummaryBlock[] {
  const isAudit = report.parameters.mode === "audit";
  const showExpected = report.parameters.knownBlockedRules.length > 0;
  const heading = isAudit ? "📋 Audited Hosts" : "✅ Allowed Hosts";
  const blocks: SummaryBlock[] = [];

  // restrict is what a real run normally uses day to day, so its heading
  // stays bare; audit is the occasional, deliberately different mode and
  // says so, the same way the heading below calls out "Audited" vs "Allowed".
  // escapeCell keeps an untrusted title from injecting Markdown or a newline.
  let top = `## ${escapeCell(title)}${isAudit ? " (audit mode)" : ""}\n\n`;

  // The tables would otherwise read as the whole story.
  if (!report.logLooksPlausible) {
    top +=
      "> ⚠️ **This report is incomplete**, so the tables below are not a full record of this run.\n" +
      "> Either the logs don't begin where a real run does, one carries a line that cannot be\n" +
      "> read, or the proxy dropped lines it could not write (or could not say whether it had).\n" +
      "> A missing beginning was either removed or rotated out by traffic heavy enough to fill the\n" +
      "> 100 MB of log kept, which takes a few hundred thousand ordinary requests or a few thousand\n" +
      "> made as long as a request can be.\n\n";
  }
  blocks.push(frame(top));

  if (report.passed.length > 0) {
    blocks.push(
      tableBlock(
        TRAFFIC_BLOCK.passed,
        5,
        `### ${heading}\n\n`,
        renderHostTable(report.passed),
        "\n",
      ),
    );
  }
  if (isAudit) {
    // inspect saw the method and the path of every request, so its example
    // can be that much narrower than one built from hosts alone. A host that
    // failed is kept either way: nothing refused it and the next run asks for
    // it again, so leaving it out would write rules that break that run.
    // Whole or not at all: a cut example would read as a complete allowlist.
    blocks.push({
      id: TRAFFIC_BLOCK.example,
      priority: 2,
      level: 2,
      section: SECTION,
      cut: "atomic",
      text:
        report.engine === "inspect"
          ? buildInspectRestrictExample(report.timeline, actionRepo, actionRef, {
              ...step,
              allowedIpRules: report.parameters.allowedIpRules,
              allowedTlsRules: report.parameters.allowedTlsRules,
            })
          : buildRestrictExample([...report.passed, ...report.failed], actionRepo, actionRef, step),
    });
  }
  if (report.blocked.length > 0) {
    // A folded row names its rule; the hosts it stands for are in the
    // Communication details section.
    const blocked = foldExpectedBlockedRows(report.blocked);
    blocks.push(
      tableBlock(
        TRAFFIC_BLOCK.blocked,
        3,
        `${report.passed.length > 0 ? "\n" : ""}### 🚫 Blocked Hosts\n\n`,
        renderHostTable(blocked, { showReason: true, showExpected }),
        "\n",
      ),
    );
  }
  if (report.failed.length > 0) {
    const gap = report.passed.length > 0 || report.blocked.length > 0 ? "\n" : "";
    // The note follows the rows, so a cut table drops it with them.
    blocks.push(
      tableBlock(
        TRAFFIC_BLOCK.failed,
        4,
        `${gap}### ⚠️ Failed Connections\n\n`,
        renderHostTable(report.failed, { showReason: true }),
        "\n\n<sub>*Note: no rule refused these; the connection itself did not complete, so no rule " +
          "can change the outcome and none of them fails the step.*</sub>\n",
      ),
    );
  }

  let bottom = "";
  if (
    report.passed.length === 0 &&
    report.blocked.length === 0 &&
    report.failed.length === 0 &&
    report.timeline.length === 0
  ) {
    // Otherwise a no-traffic run leaves nothing between the heading and the
    // footer, indistinguishable from a report that failed to generate. A run
    // that only looked names up has empty tables but a non-empty timeline, so
    // its discovery lookups still show in Communication details below.
    blocks.push(frame("_(no communication)_\n\n"));
  }

  const details = renderInspectDetailsBody(report.timeline, report.startedAt);
  if (details) {
    blocks.push({
      id: TRAFFIC_BLOCK.log,
      priority: 6,
      level: 3,
      section: SECTION,
      cut: "lines",
      open: `\n${COMMUNICATION_DETAILS_OPEN}`,
      text: details,
      close: COMMUNICATION_DETAILS_CLOSE,
    });
  }
  if (report.engine === "universal") {
    // Only the universal engine identifies a host this way (see
    // docs/security.md); inspect terminates TLS instead.
    bottom +=
      "\n<sub>*Note: HTTP rules are based on the Host header, HTTPS rules on SNI, and IP rules on the destination IP address.*</sub>\n";
  }

  bottom += `\n*Reported by [${actionRepo}](https://github.com/${actionRepo})*\n`;
  bottom += "\n<hr>\n";
  blocks.push(frame(bottom));
  return blocks;
}

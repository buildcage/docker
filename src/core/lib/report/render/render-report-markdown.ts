import type { ReportData } from "../types.ts";
import { buildRestrictExample } from "./build-example.ts";
import {
  COMMUNICATION_DETAILS_CLOSE,
  COMMUNICATION_DETAILS_OPEN,
  communicationTruncationNote,
} from "./communication-section.ts";
import { joinSummaryBlocks, type SummaryBlock } from "./fit-step-summary.ts";
import { foldExpectedBlockedRows } from "./fold-expected-blocked.ts";
import { hostTableTruncationNote, renderHostTable } from "./host-table.ts";
import {
  renderInspectDetailsBody,
  renderWouldRefuseBody,
  wouldRefuseTruncationNote,
} from "./inspect-details.ts";
import { buildInspectRestrictExample } from "./inspect-example.ts";
import { escapeCell } from "./markdown-table.ts";
import { restrictExampleTruncationNote, type ExampleStepOptions } from "./restrict-example.ts";

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
  return joinSummaryBlocks(renderReportBlocks(report, actionRepo, actionRef, JOINED, options));
}

const SECTION = "traffic";

/** The ids renderReportBlocks gives its blocks, for picking their notices. */
export const TRAFFIC_BLOCK = {
  example: "traffic-example",
  wouldRefuse: "traffic-would-refuse",
  blocked: "traffic-blocked",
  failed: "traffic-failed",
  passed: "traffic-passed",
  log: "traffic-log",
} as const;

export type TrafficBlockId = (typeof TRAFFIC_BLOCK)[keyof typeof TRAFFIC_BLOCK];

/** The priority of each block that can be cut; see SummaryBlock.priority. */
export type TrafficPriorities = Record<TrafficBlockId, number>;

// Joined whole, the report never compares priorities.
const JOINED = Object.fromEntries(
  Object.values(TRAFFIC_BLOCK).map((id) => [id, 0]),
) as TrafficPriorities;

/**
 * The notice each traffic block gives in place of what a cut dropped, or
 * undefined for a block that is not one of renderReportBlocks', so a block
 * handed to the wrong picker prints no misleading notice.
 */
export function trafficNotice(block: SummaryBlock, artifactAvailable: boolean): string | undefined {
  switch (block.id) {
    case TRAFFIC_BLOCK.example:
      return restrictExampleTruncationNote(artifactAvailable);
    case TRAFFIC_BLOCK.wouldRefuse:
      return wouldRefuseTruncationNote(artifactAvailable);
    case TRAFFIC_BLOCK.log:
      return communicationTruncationNote(artifactAvailable);
    case TRAFFIC_BLOCK.blocked:
    case TRAFFIC_BLOCK.failed:
    case TRAFFIC_BLOCK.passed:
      return hostTableTruncationNote(artifactAvailable);
    default:
      return undefined;
  }
}

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
  priority: 0,
  level: 1,
  section: SECTION,
  text,
  cut: "keep",
});

/**
 * The report as blocks for fitStepSummary, in print order. The frame (title,
 * notes, footer) is kept whole; every other block takes its priority from
 * `priorities`, and its notice is the caller's to pick with withNotices, both
 * by TRAFFIC_BLOCK id.
 */
export function renderReportBlocks(
  report: ReportData,
  actionRepo: string,
  actionRef: string,
  priorities: TrafficPriorities,
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
        priorities[TRAFFIC_BLOCK.passed],
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
      priority: priorities[TRAFFIC_BLOCK.example],
      level: 2,
      // Its own section: it stands beside the tables and the log, not above
      // them, so its notice must not silence theirs.
      section: `${SECTION}-example`,
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
        priorities[TRAFFIC_BLOCK.blocked],
        `${report.passed.length > 0 ? "\n" : ""}### 🚫 Blocked Hosts\n\n`,
        renderHostTable(blocked, { showReason: true, showExpected }),
        "\n",
      ),
    );
  }
  const wouldRefuse = renderWouldRefuseBody(report.timeline, report.startedAt);
  if (wouldRefuse) {
    const before = `${report.passed.length > 0 || report.blocked.length > 0 ? "\n" : ""}### 🚨 Restrict Would Refuse\n\n`;
    // Cut row by row like a table, whose head here is the heading and opening fence.
    blocks.push({
      id: TRAFFIC_BLOCK.wouldRefuse,
      priority: priorities[TRAFFIC_BLOCK.wouldRefuse],
      level: 2,
      section: SECTION,
      text: before + wouldRefuse,
      cut: "lines",
      head: before.split("\n").length,
    });
  }
  if (report.failed.length > 0) {
    const gap = report.passed.length > 0 || report.blocked.length > 0 || wouldRefuse ? "\n" : "";
    // The note follows the rows, so a cut table drops it with them.
    blocks.push(
      tableBlock(
        TRAFFIC_BLOCK.failed,
        priorities[TRAFFIC_BLOCK.failed],
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
      priority: priorities[TRAFFIC_BLOCK.log],
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

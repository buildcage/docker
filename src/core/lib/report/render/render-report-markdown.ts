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
import { renderInspectDetailsBody, type RefusalLabel } from "./inspect-details.ts";
import { buildInspectRestrictExample } from "./inspect-example.ts";
import { escapeCell } from "./markdown-table.ts";
import { restrictExampleTruncationNote, type ExampleStepOptions } from "./restrict-example.ts";
import { renderVerdict } from "./verdict.ts";

export interface RenderReportMarkdownOptions extends ExampleStepOptions {
  /** Heading text. May carry untrusted input: the heading escapes it. */
  title?: string;
  /** See RefusalLabel; applies to Communication details. */
  refusalLabel?: RefusalLabel;
  /** See renderVerdict's `extraItems`. */
  verdictItems?: string[];
  /**
   * A heading the report's parts go under, one level below the title, for an
   * action whose summary has other sections after this one.
   */
  section?: string;
  /** False leaves the footer to an action that prints more after the report. */
  footer?: boolean;
  /**
   * Blocks an action adds after the blocked and failed hosts for a check of
   * its own, such as the one an InspectStageExtension adds to the proxy. The
   * first opens with `gap`, the blank line owed to a block before it, and each
   * heading takes `heading`'s level, the host tables'. Their notices are the
   * caller's to pick, as for every other block.
   */
  extraBlocks?: (gap: string, heading: string) => SummaryBlock[];
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
  blocked: "traffic-blocked",
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
    case TRAFFIC_BLOCK.log:
      return communicationTruncationNote(artifactAvailable);
    case TRAFFIC_BLOCK.blocked:
    case TRAFFIC_BLOCK.passed:
      return hostTableTruncationNote(artifactAvailable);
    default:
      return undefined;
  }
}

/**
 * A table of the traffic report with the text before and after it, cut row by
 * row: its heading, header row and separator stay or the whole table gives way.
 */
export function trafficTableBlock(
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

/** A part of the report kept whole however little room is left. */
export const frame = (text: string): SummaryBlock => ({
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
  {
    title = "Outbound Traffic Report",
    refusalLabel,
    verdictItems,
    section,
    footer = true,
    extraBlocks = () => [],
    ...step
  }: RenderReportMarkdownOptions = {},
): SummaryBlock[] {
  const isAudit = report.parameters.mode === "audit";
  const showExpected = report.parameters.knownBlockedRules.length > 0;
  const h = section ? "####" : "###";
  const heading = isAudit ? "📋 Audited Hosts" : "✅ Allowed Hosts";
  const blocks: SummaryBlock[] = [];

  let top = reportHeading(title, isAudit);
  top += renderVerdict(report, verdictItems);

  // The tables would otherwise read as the whole story.
  if (!report.logLooksPlausible) {
    top +=
      "> ❗ **This report is incomplete**, so the tables below are not a full record of this run.\n" +
      "> Either the logs don't begin where a real run does, one carries a line that cannot be\n" +
      "> read, or the proxy dropped lines it could not write (or could not say whether it had).\n" +
      "> A missing beginning was either removed or rotated out by traffic heavy enough to fill the\n" +
      "> 100 MB of log kept, which takes a few hundred thousand ordinary requests or a few thousand\n" +
      "> made as long as a request can be.\n\n";
  }
  if (section) top += `### ${section}\n\n`;
  blocks.push(frame(top));
  // Each block after the first opens with a blank line, which ends the table
  // or the </details> before it.
  let wrote = false;
  const gap = () => (wrote ? "\n" : "");

  if (report.passed.length > 0) {
    blocks.push(
      trafficTableBlock(
        TRAFFIC_BLOCK.passed,
        priorities[TRAFFIC_BLOCK.passed],
        `${h} ${heading}\n\n`,
        renderHostTable(report.passed),
        "\n",
      ),
    );
    wrote = true;
  }
  if (report.blocked.length > 0 || report.failed.length > 0) {
    // A folded row names its rule; the hosts it stands for are in the
    // Communication details section. Unmatched refusals come first, as the
    // rows to act on, and the ones a rule expected last.
    const blocked = foldExpectedBlockedRows(report.blocked).map((r) => ({
      ...r,
      outcome: "blocked" as const,
    }));
    const failed = report.failed.map((r) => ({ ...r, outcome: "failed" as const }));
    const rows = [
      ...blocked.filter((r) => !r.expected),
      ...failed,
      ...blocked.filter((r) => r.expected),
    ];
    const tableTitle =
      blocked.length === 0
        ? "⚠️ Failed Hosts"
        : failed.length === 0
          ? "🚫 Blocked Hosts"
          : "🚫 Blocked / ⚠️ Failed Hosts";
    // The note follows the rows, so a cut table drops it with them.
    const note =
      failed.length === 0
        ? ""
        : "\n<sub>*Note: no rule refused the ⚠️ rows; the connection itself did not complete, so " +
          "no rule can change the outcome and none of them fails the step.*</sub>\n";
    blocks.push(
      trafficTableBlock(
        TRAFFIC_BLOCK.blocked,
        priorities[TRAFFIC_BLOCK.blocked],
        `${gap()}${h} ${tableTitle}\n\n`,
        renderHostTable(rows, { showReason: true, showExpected }),
        `\n${note}`,
      ),
    );
    wrote = true;
  }
  const extra = extraBlocks(gap(), h);
  blocks.push(...extra);
  wrote ||= extra.some((b) => b.text !== "");
  if (isAudit) {
    // inspect saw the method and the path of every request, so its example
    // can be that much narrower than one built from hosts alone. A host that
    // failed is kept either way: nothing refused it and the next run asks for
    // it again, so leaving it out would write rules that break that run.
    // Whole or not at all: a cut example would read as a complete allowlist.
    const example =
      report.engine === "inspect"
        ? buildInspectRestrictExample(report.timeline, actionRepo, actionRef, {
            ...step,
            allowedIpRules: report.parameters.allowedIpRules,
            allowedTlsRules: report.parameters.allowedTlsRules,
          })
        : buildRestrictExample([...report.passed, ...report.failed], actionRepo, actionRef, step);
    blocks.push({
      id: TRAFFIC_BLOCK.example,
      priority: priorities[TRAFFIC_BLOCK.example],
      level: 2,
      // Its own section, so a cut example's notice does not silence the
      // tables' or the log's.
      section: `${SECTION}-example`,
      cut: "atomic",
      text: example,
    });
    wrote ||= example !== "";
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
    blocks.push(frame(`${gap()}_(no communication)_\n\n`));
  }

  const details = renderInspectDetailsBody(report.timeline, report.startedAt, refusalLabel);
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

  if (footer) bottom += reportFooter(actionRepo);
  if (bottom) blocks.push(frame(bottom));
  return blocks;
}

/**
 * The report's title line. restrict is what a real run normally uses day to
 * day, so its heading stays bare; audit is the occasional, deliberately
 * different mode and says so. escapeCell keeps an untrusted title from
 * injecting Markdown or a newline.
 */
export function reportHeading(title: string, isAudit: boolean): string {
  return `## ${escapeCell(title)}${isAudit ? " (audit mode)" : ""}\n\n`;
}

/** The line every report ends with, for an action that prints it itself. */
export function reportFooter(actionRepo: string): string {
  return `\n*Reported by [${actionRepo}](https://github.com/${actionRepo})*\n\n<hr>\n`;
}

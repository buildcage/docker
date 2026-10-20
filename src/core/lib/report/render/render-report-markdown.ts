import type { ReportData } from "../types.ts";
import { buildRestrictExample } from "./build-example.ts";
import {
  COMMUNICATION_DETAILS_CLOSE,
  COMMUNICATION_DETAILS_OPEN,
  communicationTruncationNote,
} from "./communication-section.ts";
import type { SummaryBlock } from "./fit-step-summary.ts";
import { foldExpectedBlockedRows } from "./fold-expected-blocked.ts";
import { hostTableTruncationNote, renderHostTable } from "./host-table.ts";
import { renderInspectDetailsBody, type BlockLabel, type LineNote } from "./inspect-details.ts";
import { buildInspectRestrictExample } from "./inspect-example.ts";
import { escapeCell } from "./markdown-table.ts";
import { restrictExampleTruncationNote, type ExampleStepOptions } from "./restrict-example.ts";
import { renderVerdict } from "./verdict.ts";

export interface RenderReportMarkdownOptions extends ExampleStepOptions {
  /** Heading text. May carry untrusted input: the heading escapes it. */
  title?: string;
}

const SECTION = "traffic";

/** The ids of the parts' blocks, for their priorities and for telling which a fit cut. */
export const TRAFFIC_BLOCK = {
  example: "traffic-example",
  blocked: "traffic-blocked",
  passed: "traffic-passed",
  known: "traffic-known",
  log: "traffic-log",
} as const;

export type TrafficBlockId = (typeof TRAFFIC_BLOCK)[keyof typeof TRAFFIC_BLOCK];

/**
 * The traffic section's levels; see SummaryBlock.level. Once a table is cut,
 * no `nested` block given room after it prints, while the other tables and the
 * blocks already given room stay.
 */
export const TRAFFIC_LEVEL = {
  /** The report's frame, never cut. */
  frame: 1,
  table: 2,
  /**
   * Known Blocked Hosts and Communication details, and a table that reads as
   * part of the one before it. A cut one silences none of the others.
   */
  nested: 3,
} as const;

/** The priority of each block that can be cut; see SummaryBlock.priority. */
export type TrafficPriorities = Record<TrafficBlockId, number>;

/** How a part fits into a summary too large to print whole. */
export interface PartFit {
  /** See SummaryBlock.priority. */
  priority: number;
  /** Whether the notice in place of what was cut can point to the traffic artifact. */
  artifactAvailable: boolean;
}

/**
 * A table of the traffic report with the text before and after it, cut row by
 * row: its heading, header row and separator stay or the whole table gives way
 * to `notice`.
 */
export function trafficTableBlock(
  id: string,
  priority: number,
  notice: string,
  before: string,
  table: string,
  after: string,
): SummaryBlock {
  return {
    id,
    priority,
    level: TRAFFIC_LEVEL.table,
    section: SECTION,
    text: before + table + after,
    cut: "lines",
    head: before.split("\n").length + 1,
    notice,
  };
}

/** A traffic-section block kept whole however little room is left: the
 *  report's framing, or a caller's text around it. */
export const trafficFrame = (text: string): SummaryBlock => ({
  priority: 0,
  level: TRAFFIC_LEVEL.frame,
  section: SECTION,
  text,
  cut: "keep",
});

/**
 * The blocks in print order, each part a blank line after the last one that
 * printed; the first follows `heading`, which ends with one. A part carries no
 * blank line around itself, so this is the only place one is added.
 *
 * The blank line goes inside the part's first printed block, so the fit counts
 * it, a block cut to its notice keeps it (see fitStepSummary's cutBlock), and
 * a table's `head` still covers its heading.
 */
export function stackTrafficBlocks(heading: SummaryBlock, parts: SummaryBlock[][]): SummaryBlock[] {
  const blocks = [heading];
  let wrote = false;
  for (const part of parts) {
    const first = part.findIndex((b) => whole(b) !== "");
    if (first === -1) {
      blocks.push(...part);
      continue;
    }
    const b = part[first];
    const gapped = !wrote
      ? b
      : b.open !== undefined
        ? { ...b, open: `\n${b.open}` }
        : { ...b, text: `\n${b.text}`, head: b.head === undefined ? undefined : b.head + 1 };
    blocks.push(...part.slice(0, first), gapped, ...part.slice(first + 1));
    wrote = true;
  }
  return blocks;
}

const whole = (b: SummaryBlock): string => (b.open ?? "") + b.text + (b.close ?? "");

/**
 * The report's title, the verdict, and a warning when the logs do not read as
 * a whole run. `verdictItems`: see renderVerdict's `extraItems`.
 */
export function trafficHeadingBlock(
  report: ReportData,
  title: string,
  verdictItems?: string[],
): SummaryBlock {
  let top = reportHeading(title, report.parameters.mode === "audit");
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
  return trafficFrame(top);
}

/** The blocked hosts no known_blocked_rules rule matched, and the failed ones. */
export function blockedHostsBlocks(report: ReportData, fit: PartFit): SummaryBlock[] {
  const blocked = report.blocked
    .filter((r) => !r.expected)
    .map((r) => ({ ...r, outcome: "blocked" as const }));
  if (blocked.length === 0 && report.failed.length === 0) return [];
  const failed = report.failed.map((r) => ({ ...r, outcome: "failed" as const }));
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
      : "\n<sub>*Note: no rule blocked the ⚠️ rows; the connection itself did not complete, so " +
        "no rule can change the outcome and none of them fails the step.*</sub>\n";
  return [
    trafficTableBlock(
      TRAFFIC_BLOCK.blocked,
      fit.priority,
      hostTableTruncationNote(fit.artifactAvailable),
      `### ${tableTitle}\n\n`,
      renderHostTable([...blocked, ...failed], { showReason: true }),
      `\n${note}`,
    ),
  ];
}

/** The hosts let through: allowed, or in audit, audited. */
export function passedHostsBlocks(report: ReportData, fit: PartFit): SummaryBlock[] {
  if (report.passed.length === 0) return [];
  const heading = report.parameters.mode === "audit" ? "📋 Audited Hosts" : "✅ Allowed Hosts";
  return [
    trafficTableBlock(
      TRAFFIC_BLOCK.passed,
      fit.priority,
      hostTableTruncationNote(fit.artifactAvailable),
      `### ${heading}\n\n`,
      renderHostTable(report.passed),
      "\n",
    ),
  ];
}

/**
 * The blocked hosts a known_blocked_rules rule matched, collapsed: they need
 * no action.
 */
export function knownBlockedBlocks(report: ReportData, fit: PartFit): SummaryBlock[] {
  const expected = report.blocked.filter((r) => r.expected);
  if (expected.length === 0) return [];
  const hosts = new Set(expected.map((r) => r.host)).size;
  // Cut whole so the notice is not hidden in the collapsed element.
  return [
    {
      id: TRAFFIC_BLOCK.known,
      priority: fit.priority,
      level: TRAFFIC_LEVEL.nested,
      section: SECTION,
      cut: "atomic",
      notice: hostTableTruncationNote(fit.artifactAvailable),
      text:
        `<details>\n<summary>🚫 Known Blocked Hosts (${hosts} host${hosts === 1 ? "" : "s"})</summary>\n\n` +
        `${renderHostTable(foldExpectedBlockedRows(expected), { showReason: true })}\n\n</details>\n`,
    },
  ];
}

/** In audit, the restrict step to switch to; nothing in restrict. */
export function restrictExampleBlocks(
  report: ReportData,
  actionRepo: string,
  actionRef: string,
  fit: PartFit,
  step: ExampleStepOptions = {},
): SummaryBlock[] {
  if (report.parameters.mode !== "audit") return [];
  // inspect's example also narrows by method and path. A failed host is kept:
  // nothing blocked it, and leaving it out would break the next run.
  // Whole or not at all: a cut example would read as a complete allowlist.
  const example =
    report.engine === "inspect"
      ? buildInspectRestrictExample(report.timeline, actionRepo, actionRef, {
          ...step,
          allowedIpRules: report.parameters.allowedIpRules,
          allowedTlsRules: report.parameters.allowedTlsRules,
        })
      : buildRestrictExample([...report.passed, ...report.failed], actionRepo, actionRef, step);
  return [
    {
      id: TRAFFIC_BLOCK.example,
      priority: fit.priority,
      level: TRAFFIC_LEVEL.table,
      // Its own section, so a cut example's notice does not silence the
      // tables' or the log's.
      section: `${SECTION}-example`,
      cut: "atomic",
      text: example,
      notice: restrictExampleTruncationNote(fit.artifactAvailable),
    },
  ];
}

/** What a run with no traffic at all prints in place of the tables. */
export function noCommunicationBlocks(report: ReportData): SummaryBlock[] {
  // Otherwise a no-traffic run reads like a report that failed to generate.
  // A run that only looked names up has a timeline, so it shows below instead.
  const none =
    report.passed.length === 0 &&
    report.blocked.length === 0 &&
    report.failed.length === 0 &&
    report.timeline.length === 0;
  return none ? [trafficFrame("_(no communication)_\n\n")] : [];
}

/** Communication details, the timeline line by line; see renderInspectDetailsBody. */
export function communicationDetailsBlocks(
  report: ReportData,
  fit: PartFit,
  blockLabel?: BlockLabel,
  lineNote?: LineNote,
): SummaryBlock[] {
  const details = renderInspectDetailsBody(report.timeline, report.startedAt, blockLabel, lineNote);
  if (!details) return [];
  return [
    {
      id: TRAFFIC_BLOCK.log,
      priority: fit.priority,
      level: TRAFFIC_LEVEL.nested,
      section: SECTION,
      cut: "lines",
      open: COMMUNICATION_DETAILS_OPEN,
      text: details,
      close: COMMUNICATION_DETAILS_CLOSE,
      notice: communicationTruncationNote(fit.artifactAvailable),
    },
  ];
}

/** How universal identifies a host (see docs/security.md); inspect terminates TLS instead. */
export function engineNoteBlocks(report: ReportData): SummaryBlock[] {
  if (report.engine !== "universal") return [];
  return [
    trafficFrame(
      "<sub>*Note: HTTP rules are based on the Host header, HTTPS rules on SNI, and IP rules on the destination IP address.*</sub>\n",
    ),
  ];
}

/**
 * The report as blocks for fitStepSummary, in print order: what needs acting
 * on first, then what got through, then the record. The frame (title, notes,
 * footer) is kept whole; every other block takes its priority from
 * `priorities` by TRAFFIC_BLOCK id. An action that adds parts of its own
 * stacks them with the same functions in its own order instead.
 */
export function renderReportBlocks(
  report: ReportData,
  actionRepo: string,
  actionRef: string,
  priorities: TrafficPriorities,
  artifactAvailable: boolean,
  { title = "Outbound Traffic Report", ...step }: RenderReportMarkdownOptions = {},
): SummaryBlock[] {
  const fit = (id: TrafficBlockId): PartFit => ({ priority: priorities[id], artifactAvailable });
  return stackTrafficBlocks(trafficHeadingBlock(report, title), [
    blockedHostsBlocks(report, fit(TRAFFIC_BLOCK.blocked)),
    passedHostsBlocks(report, fit(TRAFFIC_BLOCK.passed)),
    knownBlockedBlocks(report, fit(TRAFFIC_BLOCK.known)),
    restrictExampleBlocks(report, actionRepo, actionRef, fit(TRAFFIC_BLOCK.example), step),
    noCommunicationBlocks(report),
    communicationDetailsBlocks(report, fit(TRAFFIC_BLOCK.log)),
    engineNoteBlocks(report),
    [trafficFrame(reportFooter(actionRepo))],
  ]);
}

/**
 * restrict, the everyday mode, keeps the title bare; audit says so. escapeCell
 * keeps an untrusted title from injecting Markdown or a newline.
 */
export function reportHeading(title: string, isAudit: boolean): string {
  return `## ${escapeCell(title)}${isAudit ? " (audit mode)" : ""}\n\n`;
}

/** The line every report ends with, for an action that prints it itself. */
export function reportFooter(actionRepo: string): string {
  return `*Reported by [${actionRepo}](https://github.com/${actionRepo})*\n\n<hr>\n`;
}

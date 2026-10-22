/** The traffic report: its parts stacked in print order. */

import type { ReportData } from "../types.ts";
import { wholeBlock, type SummaryBlock } from "./fit-step-summary.ts";
import {
  blockedHostsBlocks,
  communicationDetailsBlocks,
  engineNoteBlocks,
  knownBlockedBlocks,
  noCommunicationBlocks,
  passedHostsBlocks,
  reportFooter,
  restrictExampleBlocks,
  type RestrictExampleBlocksOptions,
  TRAFFIC_BLOCK,
  trafficFrame,
  trafficHeadingBlock,
  partFits,
  type TrafficPriorities,
} from "./traffic-parts.ts";

export interface RenderReportBlocksOptions extends RestrictExampleBlocksOptions {
  /** Heading text. May carry untrusted input: the heading escapes it. */
  title?: string;
}

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
    const first = part.findIndex((b) => wholeBlock(b) !== "");
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
  { title = "Outbound Traffic Report", ...step }: RenderReportBlocksOptions = {},
): SummaryBlock[] {
  const fit = partFits(priorities, artifactAvailable);
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

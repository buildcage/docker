import { describe, it, expect } from "vitest";

import {
  COMMUNICATION_DETAILS_CLOSE,
  COMMUNICATION_DETAILS_OPEN,
  communicationTruncationNote,
} from "./communication-section.ts";
import {
  fitStepSummary,
  joinSummaryBlocks,
  withNotices,
  type SummaryBlock,
} from "./fit-step-summary.ts";

const HEADER = "## Outbound Traffic Report (restrict mode)\n\n### ✅ Allowed Hosts\n\n";
const FOOTER = "\n*Reported by [owner/repo](https://github.com/owner/repo)*\n";

/**
 * A limit small enough that a few hundred lines exceed it, so a test that is
 * about what the cut does to the markdown says so in a few lines instead of a
 * megabyte of them. Still well above SAFETY_MARGIN_BYTES, so the budget
 * arithmetic is the same arithmetic as in production.
 */
const SMALL_LIMIT = 12 * 1024;

function logLines(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `line ${i} ${"x".repeat(20)}`);
}

const frame = (text: string, section = "traffic"): SummaryBlock => ({
  priority: 1,
  level: 1,
  section,
  text,
  cut: "keep",
});

function details(lines: string[], artifactAvailable: boolean): SummaryBlock {
  return {
    priority: 4,
    level: 3,
    section: "traffic",
    cut: "lines",
    open: `\n${COMMUNICATION_DETAILS_OPEN}`,
    text: "```\n" + lines.map((l) => `${l}\n`).join("") + "```\n\n",
    close: COMMUNICATION_DETAILS_CLOSE,
    notice: communicationTruncationNote(artifactAvailable),
  };
}

function withCommunicationDetails(lines: string[], artifactAvailable = false): SummaryBlock[] {
  return [frame(HEADER), details(lines, artifactAvailable), frame(FOOTER)];
}

const joined = joinSummaryBlocks;

describe("fitStepSummary", () => {
  it("returns small input unchanged", () => {
    const blocks = withCommunicationDetails([
      "✅ 00:00.000: GET https://a.example.com/pkg -> 200 1.0KB",
    ]);
    expect(fitStepSummary(blocks)).toBe(joined(blocks));
  });

  it("leaves oversized input unchanged when nothing in it may be cut", () => {
    const blocks = [frame(HEADER), frame("x".repeat(SMALL_LIMIT)), frame(FOOTER)];
    expect(fitStepSummary(blocks, { limitBytes: SMALL_LIMIT })).toBe(joined(blocks));
  });

  // At GitHub's real limit, not a small one: what keeps a report under 1 MiB is
  // how that limit, SAFETY_MARGIN_BYTES and the note's own length add up, and a
  // toy limit would not check those numbers leave room for each other.
  it("cuts the communication log down to fit GitHub's own limit, at a line boundary", () => {
    const lines = Array.from(
      { length: 40000 },
      (_, i) =>
        `✅ 00:00.${String(i).padStart(3, "0")}: GET https://a.example.com/pkg/${i} -> 200 1.0KB`,
    );
    const blocks = withCommunicationDetails(lines);
    expect(Buffer.byteLength(joined(blocks), "utf8") > 1024 * 1024).toBe(true);

    const truncated = fitStepSummary(blocks);
    expect(Buffer.byteLength(truncated, "utf8") <= 1024 * 1024).toBe(true);
    // Every kept line of the log survived whole, with no line cut mid-way. A
    // Set, not lines.includes per line: ~17000 kept against 40000 is 680M
    // comparisons, which put this one test within reach of the 5s timeout.
    const known = new Set(lines);
    const kept = truncated.split("\n").filter((l) => l.startsWith("✅ 00:00."));
    // A cut that kept no log line at all would satisfy the check below.
    expect(kept.length > 0).toBe(true);
    expect(kept.every((l) => known.has(l))).toBe(true);
  });

  it("closes a fence left open by the cut, so nothing after it renders as code", () => {
    const truncated = fitStepSummary(withCommunicationDetails(logLines(200)), {
      limitBytes: SMALL_LIMIT,
    });

    // Without this the check below would also hold for input that was never
    // cut, which has its fences balanced already.
    expect(truncated.includes("truncated")).toBe(true);
    // An odd number of fence markers would mean the cut left one open.
    const fenceCount = (truncated.match(/^```$/gm) ?? []).length;
    expect(fenceCount % 2).toBe(0);
    expect(truncated.includes("</details>")).toBe(true);
    expect(truncated.endsWith(FOOTER)).toBe(true);
  });

  it("points at the artifact when one was uploaded", () => {
    const truncated = fitStepSummary(withCommunicationDetails(logLines(200), true), {
      limitBytes: SMALL_LIMIT,
    });
    expect(truncated.includes("buildcage-traffic artifact")).toBe(true);
  });

  it("suggests turning the artifact on when none was uploaded", () => {
    const truncated = fitStepSummary(withCommunicationDetails(logLines(200)), {
      limitBytes: SMALL_LIMIT,
    });
    expect(truncated.includes("upload_traffic_artifact: true")).toBe(true);
  });

  it("still fits and still notes the cut even when the fixed parts alone leave no budget", () => {
    const blocks = [frame("x".repeat(SMALL_LIMIT)), ...withCommunicationDetails(["one line"])];
    const truncated = fitStepSummary(blocks, { limitBytes: SMALL_LIMIT });
    expect(truncated.includes("truncated")).toBe(true);
    expect(truncated.endsWith(FOOTER)).toBe(true);
  });

  it("counts what is already in the summary against the limit", () => {
    const blocks = withCommunicationDetails(logLines(10));
    expect(fitStepSummary(blocks, { limitBytes: SMALL_LIMIT })).toBe(joined(blocks));
    expect(fitStepSummary(blocks, { limitBytes: SMALL_LIMIT, usedBytes: SMALL_LIMIT })).toContain(
      "truncated",
    );
  });
});

describe("fitStepSummary: priorities, levels and sections", () => {
  const table = (rows: number, section = "a"): SummaryBlock => ({
    priority: 3,
    level: 2,
    section,
    cut: "lines",
    head: 4,
    text:
      "### Hosts\n\n| Host |\n| --- |\n" +
      Array.from({ length: rows }, (_, i) => `| host${i}.example.com |\n`).join(""),
    notice: `_cut ${section}_\n`,
  });
  const log = (lines: number, section = "a"): SummaryBlock => ({
    priority: 4,
    level: 3,
    section,
    cut: "lines",
    text: "```\n" + logLines(lines).join("\n") + "\n```\n",
    notice: `_log cut ${section}_\n`,
  });

  it("gives a later, higher-priority block room before an earlier, lower one", () => {
    const out = fitStepSummary([log(500, "a"), table(3, "b")], { limitBytes: SMALL_LIMIT });
    expect(out).toContain("| host2.example.com |");
    expect(out).toContain("_log cut a_");
  });

  it("cuts a table by rows, keeps its header, and ends it before the notice", () => {
    const out = fitStepSummary([table(1000)], { limitBytes: SMALL_LIMIT });
    expect(out.startsWith("### Hosts\n\n| Host |\n| --- |\n| host0.example.com |\n")).toBe(true);
    expect(out).toMatch(/\|\n\n_cut a_\n$/);
    expect(Buffer.byteLength(out, "utf8") <= SMALL_LIMIT).toBe(true);
  });

  it("gives a table wholly to its notice when not even its header fits", () => {
    const out = fitStepSummary([frame("x".repeat(SMALL_LIMIT)), table(3)], {
      limitBytes: SMALL_LIMIT,
    });
    expect(out.endsWith("_cut a_\n")).toBe(true);
    expect(out).not.toContain("| Host |");
  });

  it("silences the deeper blocks of a cut section, not those of another", () => {
    const out = fitStepSummary([table(1000, "a"), log(1, "a"), table(1, "b"), log(1, "b")], {
      limitBytes: SMALL_LIMIT,
    });
    expect(out).toContain("_cut a_");
    expect(out).not.toContain("_log cut a_");
    // Every row of section a that fits went before section b's table, so b's
    // table gives way too, and its log with it, with no notice of its own.
    expect(out).toContain("_cut b_");
    expect(out).not.toContain("_log cut b_");
  });

  it("gives a table wholly to its notice when its header fits but no row does", () => {
    const wide: SummaryBlock = { ...table(0), text: `${table(0).text}| ${"x".repeat(5000)} |\n` };
    expect(fitStepSummary([wide], { limitBytes: SMALL_LIMIT })).toBe("_cut a_\n");
  });

  it("replaces an atomic block whole rather than cutting it", () => {
    const example: SummaryBlock = {
      priority: 3,
      level: 2,
      section: "a",
      cut: "atomic",
      text: "x\n".repeat(SMALL_LIMIT),
      notice: "_example cut_\n",
    };
    expect(fitStepSummary([frame("# T\n"), example], { limitBytes: SMALL_LIMIT })).toBe(
      "# T\n_example cut_\n",
    );
  });

  it("prints a cut block with no notice of its own as just what fits", () => {
    const out = fitStepSummary([{ ...log(500), notice: undefined }], { limitBytes: SMALL_LIMIT });
    expect(out.endsWith("```\n")).toBe(true);
  });
});

describe("withNotices", () => {
  it("sets the notice it picks on each block a cut can reach, never on a kept one", () => {
    const blocks: SummaryBlock[] = [
      frame("# T\n"),
      { id: "x", priority: 2, level: 2, section: "a", cut: "lines", text: "x\n" },
      { id: "y", priority: 2, level: 2, section: "a", cut: "atomic", text: "y\n" },
    ];
    expect(withNotices(blocks, (b) => `notice ${b.id}`).map((b) => b.notice)).toEqual([
      undefined,
      "notice x",
      "notice y",
    ]);
  });
});

import { describe, it, expect } from "vitest";

import { COMMUNICATION_DETAILS_OPEN, wrapCommunicationDetails } from "./communication-section.ts";
import { truncateForStepSummary } from "./truncate-communication-details.ts";

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

function withCommunicationDetails(lines: string[]): string {
  const body = "```\n" + lines.map((l) => `${l}\n`).join("") + "```\n\n";
  return HEADER + wrapCommunicationDetails(body) + FOOTER;
}

describe("truncateForStepSummary", () => {
  it("returns small input unchanged", () => {
    const md = withCommunicationDetails([
      "✅ 00:00.000: GET https://a.example.com/pkg -> 200 1.0KB",
    ]);
    expect(truncateForStepSummary(md, false)).toBe(md);
  });

  it("leaves oversized input unchanged when it has no Communication details section to cut", () => {
    const md = HEADER + "x".repeat(SMALL_LIMIT) + FOOTER;
    expect(truncateForStepSummary(md, false, SMALL_LIMIT)).toBe(md);
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
    const md = withCommunicationDetails(lines);
    expect(Buffer.byteLength(md, "utf8") > 1024 * 1024).toBe(true);

    const truncated = truncateForStepSummary(md, false);
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
    const truncated = truncateForStepSummary(
      withCommunicationDetails(logLines(200)),
      false,
      SMALL_LIMIT,
    );

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
    const truncated = truncateForStepSummary(
      withCommunicationDetails(logLines(200)),
      true,
      SMALL_LIMIT,
    );
    expect(truncated.includes("buildcage-traffic artifact")).toBe(true);
  });

  it("suggests turning the artifact on when none was uploaded", () => {
    const truncated = truncateForStepSummary(
      withCommunicationDetails(logLines(200)),
      false,
      SMALL_LIMIT,
    );
    expect(truncated.includes("upload_traffic_artifact: true")).toBe(true);
  });

  it("still fits and still notes the cut even when the fixed parts alone leave no budget", () => {
    const md = "x".repeat(SMALL_LIMIT) + withCommunicationDetails(["one line of log"]);
    const truncated = truncateForStepSummary(md, false, SMALL_LIMIT);
    expect(truncated.includes("truncated")).toBe(true);
    expect(truncated.endsWith(FOOTER)).toBe(true);
  });
});

describe("markdown the truncator cannot work with", () => {
  it("returns it unchanged when the details block is never closed", () => {
    const markdown = `${HEADER}${COMMUNICATION_DETAILS_OPEN}${"y".repeat(SMALL_LIMIT)}`;
    expect(truncateForStepSummary(markdown, false, SMALL_LIMIT)).toBe(markdown);
  });
});

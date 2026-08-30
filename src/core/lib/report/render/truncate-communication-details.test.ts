import { describe, it, expect, reportResults } from "#core/lib/test/test-shim.ts";
import { truncateForStepSummary } from "./truncate-communication-details.ts";

const HEADER = "## Outbound Traffic Report (restrict mode)\n\n### ✅ Allowed Hosts\n\n";
const FOOTER = "\n*Reported by [buildcage/docker](https://github.com/buildcage/docker)*\n";

function withCommunicationDetails(lines: string[]): string {
  return (
    HEADER +
    "\n<details>\n<summary>\u{1F4AC} Communication details</summary>\n\n```\n" +
    lines.map((l) => `${l}\n`).join("") +
    "```\n\n</details>\n" +
    FOOTER
  );
}

describe("truncateForStepSummary", () => {
  it("returns small input unchanged", () => {
    const md = withCommunicationDetails([
      "✅ 00:00.000: GET https://a.example.com/pkg -> 200 1.0KB",
    ]);
    expect(truncateForStepSummary(md, false)).toBe(md);
  });

  it("leaves oversized input unchanged when it has no Communication details section to cut", () => {
    const md = HEADER + "x".repeat(2 * 1024 * 1024) + FOOTER;
    expect(truncateForStepSummary(md, false)).toBe(md);
  });

  it("cuts the communication log down to fit, at a line boundary", () => {
    const lines = Array.from(
      { length: 40000 },
      (_, i) =>
        `✅ 00:00.${String(i).padStart(3, "0")}: GET https://a.example.com/pkg/${i} -> 200 1.0KB`,
    );
    const md = withCommunicationDetails(lines);
    expect(Buffer.byteLength(md, "utf8") > 1024 * 1024).toBe(true);

    const truncated = truncateForStepSummary(md, false);
    expect(Buffer.byteLength(truncated, "utf8") <= 1024 * 1024).toBe(true);
    // Every kept line of the log survived whole -- no line is cut mid-way.
    for (const line of truncated.split("\n")) {
      expect(line.startsWith("✅ 00:00.") ? lines.includes(line) : true).toBe(true);
    }
  });

  it("closes a fence left open by the cut, so nothing after it renders as code", () => {
    const lines = Array.from({ length: 40000 }, (_, i) => `line ${i} ${"x".repeat(20)}`);
    const md = withCommunicationDetails(lines);
    const truncated = truncateForStepSummary(md, false);

    // An odd number of fence markers would mean the cut left one open.
    const fenceCount = (truncated.match(/^```$/gm) ?? []).length;
    expect(fenceCount % 2).toBe(0);
    expect(truncated.includes("</details>")).toBe(true);
    expect(truncated.endsWith(FOOTER)).toBe(true);
  });

  it("points at the artifact when one was uploaded", () => {
    const lines = Array.from({ length: 40000 }, (_, i) => `line ${i} ${"x".repeat(20)}`);
    const truncated = truncateForStepSummary(withCommunicationDetails(lines), true);
    expect(truncated.includes("buildcage-traffic artifact")).toBe(true);
  });

  it("suggests turning the artifact on when none was uploaded", () => {
    const lines = Array.from({ length: 40000 }, (_, i) => `line ${i} ${"x".repeat(20)}`);
    const truncated = truncateForStepSummary(withCommunicationDetails(lines), false);
    expect(truncated.includes("upload_traffic_artifact: true")).toBe(true);
  });

  it("still fits and still notes the cut even when the fixed parts alone leave no budget", () => {
    const hugeHeader = "x".repeat(1024 * 1024);
    const lines = ["one line of log"];
    const md = hugeHeader + withCommunicationDetails(lines);
    const truncated = truncateForStepSummary(md, false);
    expect(truncated.includes("truncated")).toBe(true);
    expect(truncated.endsWith(FOOTER)).toBe(true);
  });
});

reportResults();

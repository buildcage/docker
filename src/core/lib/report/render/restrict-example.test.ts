/**
 * The frame every engine's "Switch to restrict mode" snippet is built around.
 * Each renderer's own tests assert the YAML it puts inside; these assert the
 * frame, so no renderer's tests have to.
 */
import { describe, it, expect } from "vitest";

import {
  exampleStepHead,
  restrictExampleBlock,
  restrictExampleTruncationNote,
  usesLine,
} from "./restrict-example.ts";

const REPO = "owner/repo";

describe("usesLine", () => {
  it("writes the ref as given, tag or commit sha alike", () => {
    const sha = "a".repeat(40);
    expect(usesLine(REPO, "v2")).toBe(`  uses: ${REPO}@v2\n`);
    expect(usesLine(REPO, "v2.1.0")).toBe(`  uses: ${REPO}@v2.1.0\n`);
    expect(usesLine(REPO, sha)).toBe(`  uses: ${REPO}@${sha}\n`);
  });

  it("appends the resolved version as a trailing comment, and nothing when it is unknown", () => {
    expect(usesLine(REPO, "v2", "3.1.4")).toBe(`  uses: ${REPO}@v2 # 3.1.4\n`);
    expect(usesLine(REPO, "v2", undefined)).toBe(`  uses: ${REPO}@v2\n`);
    expect(usesLine(REPO, "v2", "")).toBe(`  uses: ${REPO}@v2\n`);
  });
});

describe("exampleStepHead", () => {
  it("names the step Start Buildcage unless told otherwise", () => {
    expect(exampleStepHead(REPO, "v2")).toBe(
      `- name: Start Buildcage\n  uses: ${REPO}@v2\n  with:\n`,
    );
    expect(exampleStepHead(REPO, "v2", { stepName: "Start isolated-run" })).toBe(
      `- name: Start isolated-run\n  uses: ${REPO}@v2\n  with:\n`,
    );
  });

  it("repeats a run command under run: |, one line each, with no trailing blank line", () => {
    expect(exampleStepHead(REPO, "v2", { runCommand: "npm ci\nnpm test\n" })).toBe(
      `- name: Start Buildcage\n  uses: ${REPO}@v2\n  with:\n    run: |\n      npm ci\n      npm test\n`,
    );
  });
});

describe("restrictExampleBlock", () => {
  it("wraps the yaml in the collapsed section, at the step indent Actions expects", () => {
    // A blank line stays blank: trailing spaces on it would show in the fence.
    expect(restrictExampleBlock("- name: Start\n  with:\n\n    x: 1\n")).toBe(
      "\n<details>\n" +
        "<summary>🛡️ Switch to restrict mode</summary>\n\n" +
        "```yaml\n" +
        "      - name: Start\n" +
        "        with:\n" +
        "\n" +
        "          x: 1\n" +
        "```\n\n" +
        "</details>\n",
    );
  });

  it("renders a footnote as small print under the fence when one is given", () => {
    expect(restrictExampleBlock("x\n", { footnote: "only the host is checked" })).toContain(
      "```\n\n<sub>*only the host is checked*</sub>\n\n</details>\n",
    );
  });
});

describe("restrictExampleTruncationNote", () => {
  it("points at the artifact when one was uploaded", () => {
    expect(restrictExampleTruncationNote(true)).toContain("buildcage-traffic artifact");
  });

  it("suggests turning the artifact on when none was uploaded", () => {
    expect(restrictExampleTruncationNote(false)).toContain("upload_traffic_artifact: true");
  });
});

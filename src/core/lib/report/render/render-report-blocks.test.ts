import { describe, it, expect } from "vitest";

import { reportParams } from "#core/lib/test/report-data.node.ts";

import type { UniversalReportData } from "../types.ts";
import { communicationTruncationNote } from "./communication-section.ts";
import { fitStepSummary, withNotices } from "./fit-step-summary.ts";
import { renderReportBlocks, TRAFFIC_BLOCK } from "./render-report-markdown.ts";
import { restrictExampleTruncationNote } from "./restrict-example.ts";

const LIMIT = 16 * 1024;

const rows = (prefix: string, n: number, reason = "-") =>
  Array.from({ length: n }, (_, i) => ({
    host: `${prefix}${i}.example.com`,
    port: "443",
    ruleType: "HTTPS",
    reason,
    count: 1,
  }));

function report(overrides: Partial<UniversalReportData>): UniversalReportData {
  return {
    engine: "universal",
    parameters: reportParams(),
    passed: [],
    blocked: [],
    failed: [],
    blockedCount: 0,
    logLooksPlausible: true,
    timeline: [],
    startedAt: undefined,
    ...overrides,
  };
}

function fit(r: UniversalReportData): string {
  return fitStepSummary(
    withNotices(renderReportBlocks(r, "owner/repo", "v1"), (b) =>
      b.id === TRAFFIC_BLOCK.example
        ? restrictExampleTruncationNote(false)
        : communicationTruncationNote(false),
    ),
    LIMIT,
  );
}

describe("renderReportBlocks under a limit", () => {
  it("keeps the blocked and failed tables whole and cuts the allowed one", () => {
    const out = fit(
      report({
        passed: rows("ok", 2000),
        blocked: rows("bad", 3, "not-allowed").map((r) => ({ ...r, expected: false })),
        blockedCount: 3,
        failed: rows("down", 2, "conn-reset"),
      }),
    );
    expect(out).toContain("bad2.example.com");
    expect(out).toContain("down1.example.com");
    expect(out).toContain("none of them fails the step");
    expect(out).toContain("ok0.example.com");
    expect(out).not.toContain("ok1999.example.com");
    expect(out).toContain("truncated: the full communication log");
  });

  it("keeps the example whole ahead of the tables in audit mode", () => {
    const out = fit(
      report({ parameters: reportParams({ mode: "audit" }), passed: rows("ok", 120) }),
    );
    // The example lists every host the table does.
    expect(out).toContain("ok119.example.com:443");
    expect(out).not.toContain("example restrict step is too large");
  });

  it("gives an example too large to print its own notice", () => {
    const out = fit(
      report({ parameters: reportParams({ mode: "audit" }), passed: rows("ok", 2000) }),
    );
    expect(out).toContain(restrictExampleTruncationNote(false));
    expect(out).not.toContain("ok1999.example.com:443");
  });
});

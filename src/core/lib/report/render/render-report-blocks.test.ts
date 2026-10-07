import { describe, it, expect } from "vitest";

import type { TrafficEvent } from "#core/lib/log/traffic-event.ts";
import { reportParams } from "#core/lib/test/report-data.node.ts";

import type { ReportData, UniversalReportData } from "../types.ts";
import { communicationTruncationNote } from "./communication-section.ts";
import { fitStepSummary, withNotices } from "./fit-step-summary.ts";
import { hostTableTruncationNote } from "./host-table.ts";
import {
  renderReportBlocks,
  TRAFFIC_BLOCK,
  trafficNotice,
  type TrafficPriorities,
} from "./render-report-markdown.ts";
import { restrictExampleTruncationNote } from "./restrict-example.ts";

const LIMIT = 16 * 1024;

const PRIORITIES: TrafficPriorities = {
  [TRAFFIC_BLOCK.example]: 2,
  [TRAFFIC_BLOCK.blocked]: 3,
  [TRAFFIC_BLOCK.failed]: 4,
  [TRAFFIC_BLOCK.passed]: 5,
  [TRAFFIC_BLOCK.log]: 6,
};

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

function fit(r: ReportData): string {
  return fitStepSummary(
    withNotices(renderReportBlocks(r, "owner/repo", "v1", PRIORITIES), (b) =>
      trafficNotice(b, false),
    ),
    { limitBytes: LIMIT },
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
    expect(out).toContain(hostTableTruncationNote(false));
  });

  it("gives a cut communication log the log's own notice", () => {
    const timeline: TrafficEvent[] = Array.from({ length: 1000 }, (_, i) => ({
      time: 1 + i,
      action: "allow",
      protocol: "https",
      host: `h${i}.example.com`,
      port: 443,
    }));
    const out = fit(report({ timeline }));
    expect(out).toContain(communicationTruncationNote(false));
    expect(out).not.toContain(hostTableTruncationNote(false));
  });

  it("keeps the example whole ahead of the tables in audit mode", () => {
    const out = fit(
      report({ parameters: reportParams({ mode: "audit" }), passed: rows("ok", 120) }),
    );
    // The example lists every host the table does.
    expect(out).toContain("ok119.example.com:443");
    expect(out).not.toContain("example restrict step is too large");
  });

  it("still prints the communication log when the example is replaced", () => {
    // The example lists every host the timeline reached, so a few hundred of
    // them outgrow the limit while the host table, built apart, stays short.
    const timeline: TrafficEvent[] = Array.from({ length: 400 }, (_, i) => ({
      time: 1 + i,
      action: "allow",
      protocol: "https",
      host: `${"h".repeat(40)}${i}.example.com`,
      port: 443,
      method: "GET",
      url: `https://${"h".repeat(40)}${i}.example.com/`,
      status: 200,
    }));
    const out = fit({
      ...report({ parameters: reportParams({ mode: "audit" }), passed: rows("api", 1), timeline }),
      engine: "inspect",
    });
    expect(out).toContain(restrictExampleTruncationNote(false));
    expect(out).toContain("Communication details");
  });

  it("gives an example too large to print its own notice", () => {
    const out = fit(
      report({ parameters: reportParams({ mode: "audit" }), passed: rows("ok", 2000) }),
    );
    expect(out).toContain(restrictExampleTruncationNote(false));
    expect(out).not.toContain("ok1999.example.com:443");
  });

  it("picks no notice for a block that is not the traffic report's", () => {
    const block = {
      id: "filesystem-log",
      priority: 1,
      level: 1,
      section: "fs",
      text: "",
      cut: "lines" as const,
    };
    expect(trafficNotice(block, true)).toBeUndefined();
  });
});

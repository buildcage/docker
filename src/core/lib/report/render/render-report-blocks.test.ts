import { describe, it, expect } from "vitest";

import type { TrafficEvent } from "#core/lib/log/traffic-event.ts";
import { reportParams } from "#core/lib/test/report-data.node.ts";

import type { ReportData, UniversalReportData } from "../types.ts";
import { communicationTruncationNote } from "./communication-section.ts";
import { fitStepSummary, joinSummaryBlocks, withNotices } from "./fit-step-summary.ts";
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
  [TRAFFIC_BLOCK.blocked]: 4,
  [TRAFFIC_BLOCK.passed]: 6,
  [TRAFFIC_BLOCK.known]: 7,
  [TRAFFIC_BLOCK.log]: 8,
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
  it("keeps the blocked and failed table whole and cuts the allowed one", () => {
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

  it("cuts the known blocked hosts before the allowed ones, keeping the details element closed", () => {
    const known = rows("noise", 2000, "not-allowed").map((r) => ({
      ...r,
      expected: true,
      expectedBy: r.host,
    }));
    const out = fit(report({ passed: rows("ok", 20), blocked: known, blockedCount: 2000 }));
    expect(out).toContain("ok19.example.com");
    expect(out).toContain("<summary>🚫 Known Blocked Hosts (2000)</summary>");
    expect(out).not.toContain("noise1999.example.com");
    expect(out).toContain(`${hostTableTruncationNote(false)}\n</details>`);
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

  it("ends the example with a blank line before whatever follows it", () => {
    const audit = reportParams({ mode: "audit" });
    expect(fit(report({ parameters: audit, failed: rows("down", 1, "conn-reset") }))).toContain(
      "</details>\n\n<sub>*Note: HTTP rules",
    );
    expect(
      fit(
        report({
          parameters: audit,
          passed: rows("ok", 1),
          timeline: [
            { time: 0, action: "allow", protocol: "https", host: "a.example.com", port: 443 },
          ],
        }),
      ),
    ).toContain("</details>\n\n<details>\n<summary>💬 Communication details");
    // A TLS rule alone writes an example for a run that reached nothing.
    expect(
      fit({
        ...report({
          parameters: reportParams({ mode: "audit", allowedTlsRules: ["example.com"] }),
        }),
        engine: "inspect",
      }),
    ).toContain("</details>\n\n_(no communication)_");
  });

  it("puts the example after the tables, before the communication log", () => {
    const out = fit({
      ...report({
        parameters: reportParams({ mode: "audit" }),
        passed: rows("ok", 1),
        blocked: rows("bad", 1, "not-allowed").map((r) => ({ ...r, expected: false })),
        blockedCount: 1,
        failed: rows("down", 1, "conn-reset"),
        timeline: [
          {
            time: 0,
            action: "audit",
            protocol: "https",
            host: "ok0.example.com",
            port: 443,
            method: "GET",
            url: "https://ok0.example.com/",
            status: 200,
            wouldBlock: "example-block",
          },
        ],
      }),
      engine: "inspect",
    });
    const order = [
      "### 🚫 Blocked / ⚠️ Failed Hosts",
      "### 📋 Audited Hosts",
      "🛡️ Switch to restrict mode",
      "💬 Communication details",
    ].map((heading) => out.indexOf(heading));
    expect(order.every((at) => at !== -1)).toBe(true);
    expect(order).toStrictEqual(order.toSorted((a, b) => a - b));
  });

  it("puts an action's own blocks between the blocked table and the allowed one, a blank line apart", () => {
    const extra = (gap: string) => [
      {
        id: "extra",
        priority: 1,
        level: 2,
        section: "traffic",
        cut: "keep" as const,
        text: `${gap}EXTRA\n`,
      },
    ];
    const render = (r: UniversalReportData) =>
      joinSummaryBlocks(
        renderReportBlocks(r, "owner/repo", "v1", PRIORITIES, { extraBlocks: extra }),
      );
    const out = render(
      report({
        blocked: rows("bad", 1, "not-allowed").map((r) => ({ ...r, expected: false })),
        blockedCount: 1,
        failed: rows("down", 1, "conn-reset"),
      }),
    );
    expect(out).toContain("the step.*</sub>\n\nEXTRA\n");
    expect(render(report({}))).toContain("## Outbound Traffic Report\n\nEXTRA\n\n_(no");
    const empty = joinSummaryBlocks(
      renderReportBlocks(report({}), "owner/repo", "v1", PRIORITIES, {
        extraBlocks: (gap) => [{ ...extra(gap)[0], text: "" }],
      }),
    );
    expect(empty).toContain("## Outbound Traffic Report\n\n_(no");
    expect(render(report({ passed: rows("ok", 1) }))).toContain(
      "## Outbound Traffic Report\n\nEXTRA\n\n### ✅ Allowed Hosts",
    );
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

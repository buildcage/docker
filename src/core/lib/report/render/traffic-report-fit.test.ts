import { describe, it, expect } from "vitest";

import type { TrafficEvent } from "#core/lib/log/traffic-event.ts";
import { reportParams } from "#core/lib/test/report-data.node.ts";

import type { ReportData, UniversalReportData } from "../types.ts";
import { communicationTruncationNote } from "./communication-details.ts";
import {
  fitStepSummary,
  joinSummaryBlocks,
  SAFETY_MARGIN_BYTES,
  type SummaryBlock,
} from "./fit-step-summary.ts";
import { hostTableTruncationNote } from "./host-table.ts";
import { restrictExampleTruncationNote } from "./restrict-example.ts";
import {
  TRAFFIC_BLOCK,
  trafficFrame,
  trafficTableBlock,
  type TrafficPriorities,
} from "./traffic-parts.ts";
import { renderReportBlocks, stackTrafficBlocks } from "./traffic-report.ts";

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
  return fitStepSummary(renderReportBlocks(r, "owner/repo", "v1", PRIORITIES, false), {
    limitBytes: LIMIT,
  });
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

  it("replaces a known blocked table that does not fit with its notice and still prints the log", () => {
    const known = rows("noise", 2000, "not-allowed").map((r) => ({
      ...r,
      expected: true,
      expectedBy: r.host,
    }));
    const timeline: TrafficEvent[] = [
      { time: 0, action: "allow", protocol: "https", host: "ok0.example.com", port: 443 },
    ];
    const out = fit(
      report({ passed: rows("ok", 20), blocked: known, blockedCount: 2000, timeline }),
    );
    expect(out).toContain("ok19.example.com");
    expect(out).not.toContain("Known Blocked Hosts");
    expect(out).toContain(`|\n\n${hostTableTruncationNote(false)}`);
    expect(out).toContain("💬 Communication details");
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

  it("prints no notice for an example with nothing in it, however little room is left", () => {
    // A TLS rule alone is what gives inspect an example; without one there is none.
    const r = {
      ...report({ parameters: reportParams({ mode: "audit" }) }),
      engine: "inspect" as const,
    };
    const blocks = renderReportBlocks(r, "owner/repo", "v1", PRIORITIES, false);
    expect(blocks.some((b) => b.id === TRAFFIC_BLOCK.example)).toBe(false);
    expect(fitStepSummary(blocks, { limitBytes: 1 })).not.toContain("omitted");
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

  it("leaves one blank line between a cut part's notice and what follows", () => {
    const out = fit({
      ...report({
        parameters: reportParams({ mode: "audit" }),
        passed: rows("ok", 2000),
        blocked: rows("bad", 3000, "not-allowed").map((r) => ({ ...r, expected: false })),
        blockedCount: 3000,
      }),
      engine: "inspect",
    });
    expect(out).toContain(hostTableTruncationNote(false));
    expect(out).not.toContain("\n\n\n");
  });
});

describe("stackTrafficBlocks", () => {
  const heading = trafficFrame("## T\n\n");
  const block = (text: string, extra: Partial<SummaryBlock> = {}): SummaryBlock => ({
    priority: 1,
    level: 2,
    section: "traffic",
    cut: "keep",
    text,
    ...extra,
  });
  const join = (parts: SummaryBlock[][]) => joinSummaryBlocks(stackTrafficBlocks(heading, parts));

  it("sets each part a blank line after the last one that printed", () => {
    expect(join([[block("A\n")], [block("B\n")], [block("C\n")]])).toBe("## T\n\nA\n\nB\n\nC\n");
  });

  it("starts the first part right after the heading", () => {
    expect(join([[], [block("")], [block("A\n")]])).toBe("## T\n\nA\n");
  });

  it("skips a part that printed nothing", () => {
    expect(join([[block("A\n")], [block("")], [], [block("B\n")]])).toBe("## T\n\nA\n\nB\n");
  });

  it("opens a part's tags with the blank line rather than its text", () => {
    expect(join([[block("A\n")], [block("B\n", { open: "<o>", close: "</o>" })]])).toBe(
      "## T\n\nA\n\n<o>B\n</o>",
    );
  });

  it("gives the blank line to the part's first block that prints", () => {
    expect(join([[block("A\n")], [block(""), block("B\n"), block("C\n")]])).toBe(
      "## T\n\nA\n\nB\nC\n",
    );
  });

  // The blank line is a line of the table's block, so the rows the cut must
  // keep with the heading count it too; otherwise a cut could keep the heading
  // and header row with no separator or rows under them.
  it("never cuts a stacked table to its heading without a row", () => {
    const rows = Array.from({ length: 50 }, (_, i) => `| r${i} |`).join("\n");
    const table = trafficTableBlock(
      "t",
      5,
      "_cut_\n",
      "### Table\n\n",
      `| h |\n| --- |\n${rows}\n`,
      "\n",
    );
    const blocks = stackTrafficBlocks(heading, [[block("A\n")], [table]]);
    expect(blocks[2]).toMatchObject({ head: (table.head ?? 0) + 1 });
    const frame = Buffer.byteLength("## T\n\nA\n");
    for (let room = 0; room < 400; room++) {
      const out = fitStepSummary(blocks, { limitBytes: SAFETY_MARGIN_BYTES + frame + room });
      const rest = out.slice(frame);
      expect(rest.startsWith("\n")).toBe(true);
      if (rest.includes("### Table")) {
        expect(rest).toMatch(/^\n### Table\n\n\| h \|\n\| --- \|\n\| r0 \|\n/);
      } else {
        expect(rest).toBe("\n_cut_\n");
      }
    }
  });

  it("keeps the blank line before the notice of a part replaced whole", () => {
    const atomic = { ...block("X".repeat(200) + "\n"), cut: "atomic" as const, notice: "_cut_\n" };
    const blocks = stackTrafficBlocks(heading, [[block("A\n")], [atomic], [block("B\n")]]);
    const out = fitStepSummary(blocks, { limitBytes: SAFETY_MARGIN_BYTES + 100 });
    expect(out).toBe("## T\n\nA\n\n_cut_\n\nB\n");
  });

  it("keeps the blank line before the notice of a collapsed part replaced whole", () => {
    const collapsed = {
      ...block("X".repeat(200) + "\n", { open: "<o>\n", close: "</o>\n" }),
      cut: "atomic" as const,
      notice: "_cut_\n",
    };
    const blocks = stackTrafficBlocks(heading, [[block("A\n")], [collapsed], [block("B\n")]]);
    const out = fitStepSummary(blocks, { limitBytes: SAFETY_MARGIN_BYTES + 100 });
    expect(out).toBe("## T\n\nA\n\n_cut_\n\nB\n");
  });
});

import { describe, it, expect } from "vitest";

import type { TrafficEvent } from "#core/lib/log/traffic-event.ts";
import { reportParams } from "#core/lib/test/report-data.node.ts";

import type { UniversalReportData } from "../types.ts";
import { renderVerdict } from "./verdict.ts";

const row = (count: number, expected: boolean) => ({
  host: "bad.com",
  port: "443",
  ruleType: "HTTPS",
  reason: "https-not-allowed",
  count,
  expected,
});

const undecided: TrafficEvent = {
  time: 0,
  action: "incomplete",
  protocol: "https",
  host: "untrusted.example.com",
  port: 443,
  reason: "client-aborted",
};

const base: UniversalReportData = {
  engine: "universal",
  parameters: reportParams(),
  passed: [],
  blocked: [],
  failed: [],
  blockedCount: 0,
  logLooksPlausible: true,
  timeline: [],
  startedAt: undefined,
};

describe("renderVerdict", () => {
  it("says nothing when nothing needs a look", () => {
    expect(renderVerdict(base)).toBe("");
  });

  it("counts requests, in the order blocked, extra items, failed, not acted on, as a caution", () => {
    const verdict = renderVerdict(
      {
        ...base,
        blocked: [row(2, false), row(1, false), row(5, true)],
        blockedCount: 8,
        failed: [
          { host: "down.com", port: "443", ruleType: "HTTPS", reason: "dns-failed", count: 3 },
        ],
        timeline: [undecided],
      },
      ["4 restrict would block"],
    );
    expect(verdict).toBe(
      "> [!CAUTION]\n> 3 blocked · 4 restrict would block · 3 failed · 1 not acted on · " +
        "5 blocked as expected\n\n",
    );
  });

  it("warns when nothing was blocked but something else needs a look", () => {
    const failed = [
      { host: "down.com", port: "443", ruleType: "HTTPS", reason: "dns-failed", count: 3 },
    ];
    expect(renderVerdict({ ...base, failed })).toBe("> [!WARNING]\n> 3 failed\n\n");
    expect(renderVerdict({ ...base, timeline: [undecided] }, ["2 restrict would block"])).toBe(
      "> [!WARNING]\n> 2 restrict would block · 1 not acted on\n\n",
    );
    expect(renderVerdict({ ...base, failed, blocked: [row(2, true)], blockedCount: 2 })).toBe(
      "> [!WARNING]\n> 3 failed · 2 blocked as expected\n\n",
    );
  });

  it("says nothing when every block was expected", () => {
    expect(renderVerdict({ ...base, blocked: [row(2, true)], blockedCount: 2 })).toBe("");
  });

  it("leads with a log that is not a full record, as a caution", () => {
    const incomplete = { ...base, logLooksPlausible: false };
    expect(renderVerdict(incomplete)).toBe("> [!CAUTION]\n> report incomplete\n\n");
    expect(renderVerdict({ ...incomplete, blocked: [row(2, true)], blockedCount: 2 })).toBe(
      "> [!CAUTION]\n> report incomplete · 2 blocked as expected\n\n",
    );
  });

  it("counts blocked requests with no row as unexpected, as the outcome does", () => {
    expect(renderVerdict({ ...base, blockedCount: 2 })).toBe("> [!CAUTION]\n> 2 blocked\n\n");
  });

  it("leaves out a close that is keepalive noise, as the warning does", () => {
    const timeline: TrafficEvent[] = [{ ...undecided, action: "allow", status: 200 }, undecided];
    expect(renderVerdict({ ...base, timeline })).toBe("");
  });
});

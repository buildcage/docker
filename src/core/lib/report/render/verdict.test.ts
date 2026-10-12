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
  it("says nothing was refused when nothing needs a look", () => {
    expect(renderVerdict(base)).toBe("**✅ Nothing was refused**\n\n");
  });

  it("counts requests, in the order refused, extra items, failed, not acted on", () => {
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
      ["🚨 4 restrict would refuse"],
    );
    expect(verdict).toBe(
      "**🚫 3 refused · 🚨 4 restrict would refuse · ⚠️ 3 failed · ⚠️ 1 not acted on · " +
        "5 refused as expected**\n\n",
    );
  });

  it("leads with expected refusals only when nothing else is there", () => {
    expect(renderVerdict({ ...base, blocked: [row(2, true)], blockedCount: 2 })).toBe(
      "**✅ 2 refused as expected**\n\n",
    );
  });

  it("leads with a log that is not a full record, and then never says ✅", () => {
    const incomplete = { ...base, logLooksPlausible: false };
    expect(renderVerdict(incomplete)).toBe("**❗ report incomplete**\n\n");
    expect(renderVerdict({ ...incomplete, blocked: [row(2, true)], blockedCount: 2 })).toBe(
      "**❗ report incomplete · 2 refused as expected**\n\n",
    );
  });

  it("counts refusals with no row as unexpected, as the outcome does", () => {
    expect(renderVerdict({ ...base, blockedCount: 2 })).toBe("**🚫 2 refused**\n\n");
  });

  it("leaves out a close that is keepalive noise, as the warning does", () => {
    const timeline: TrafficEvent[] = [{ ...undecided, action: "allow", status: 200 }, undecided];
    expect(renderVerdict({ ...base, timeline })).toBe("**✅ Nothing was refused**\n\n");
  });
});

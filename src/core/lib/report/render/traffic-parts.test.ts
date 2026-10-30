import { describe, it, expect } from "vitest";

import type { TrafficEvent } from "#core/lib/log/traffic-event.ts";
import { reportParams, UNINTERRUPTED } from "#core/lib/test/report-data.node.ts";

import type { InspectReportData, UniversalReportData } from "../types.ts";
import { joinSummaryBlocks } from "./fit-step-summary.ts";
import {
  communicationDetailsBlocks,
  engineNoteBlocks,
  restrictExampleBlocks,
  trafficHeadingBlock,
  trafficTableBlock,
} from "./traffic-parts.ts";

const FIT = { priority: 1, artifactAvailable: false };

const allowedRow = { host: "good.com", port: "443", ruleType: "HTTPS", reason: "-", count: 1 };
const blockedRow = {
  host: "bad.com",
  port: "80",
  ruleType: "HTTP",
  reason: "not-allowed",
  count: 1,
  expected: false,
};

const universal: UniversalReportData = {
  engine: "universal",
  parameters: reportParams(),
  passed: [allowedRow],
  blocked: [blockedRow],
  failed: [],
  blockedCount: 1,
  logLooksPlausible: true,
  ...UNINTERRUPTED,
  timeline: [],
  startedAt: undefined,
};

describe("trafficHeadingBlock", () => {
  it("puts the verdict and the action's own items under the title", () => {
    expect(
      trafficHeadingBlock(universal, "Outbound Traffic Report", { warning: ["1 x"] }).text,
    ).toBe("## Outbound Traffic Report\n\n> [!CAUTION]\n> 1 blocked · 1 x\n\n");
  });

  it("raises an action's caution in the verdict when nothing was blocked", () => {
    const clean = { ...universal, blocked: [], blockedCount: 0 };
    expect(trafficHeadingBlock(clean, "Outbound Traffic Report", { caution: ["1 x"] }).text).toBe(
      "## Outbound Traffic Report\n\n> [!CAUTION]\n> 1 x\n\n",
    );
  });

  it("marks an audit run in the title", () => {
    const audit = { ...universal, parameters: reportParams({ mode: "audit" }) };
    expect(trafficHeadingBlock(audit, "T").text).toMatch(/^## T \(audit mode\)\n\n/);
  });

  it("escapes structural Markdown in the title, so no caller can inject via it", () => {
    const { text } = trafficHeadingBlock(
      { ...universal, parameters: reportParams({ mode: "audit" }) },
      "Outbound Traffic Report — [x](javascript:alert(1))\n# owned <b>|*",
    );
    expect(text.split("\n")[0]).toBe(
      "## Outbound Traffic Report — \\[x\\](javascript:alert(1)) # owned \\<b\\>\\|\\* (audit mode)",
    );
  });

  it("warns under the verdict when the log is not a complete record", () => {
    const { text } = trafficHeadingBlock({ ...universal, logLooksPlausible: false }, "T");
    const [warning] = text.split("\n\n").filter((b) => b.includes("This report is incomplete"));
    // A continuation line without the marker leaves the blockquote and renders
    // as body text.
    for (const line of warning.split("\n")) expect(line).toMatch(/^> /);
    expect(warning.replaceAll("\n> ", " ")).toMatch(
      /Either the logs don't begin where a real run does, one carries a line that cannot be read, or the proxy dropped lines it could not write/,
    );
  });

  it("names a proxy that stopped or restarted before the causes it can only list", () => {
    const { text } = trafficHeadingBlock(
      {
        ...universal,
        logLooksPlausible: false,
        proxyAnswered: false,
        restarts: { proxy: 1, resolver: 0 },
      },
      "T",
    );
    const [warning] = text.split("\n\n").filter((b) => b.includes("This report is incomplete"));
    for (const line of warning.split("\n")) expect(line).toMatch(/^> /);
    expect(warning.split("\n").slice(1, 5)).toStrictEqual([
      "> The proxy did not answer the report, so it stopped or hung during the run. Requests made while it was down failed rather than going around it, and the step fails for this whatever the mode or fail-on-blocked.",
      "> The proxy restarted 1 time(s) during the run.",
      "> A restart loses the line of whatever was still in progress when the service stopped.",
      "> Other causes may apply too: the logs don't begin where a real run does, one carries a line that cannot be",
    ]);
  });

  it("has no warning when the log is a complete record", () => {
    expect(trafficHeadingBlock(universal, "T").text).not.toMatch(/incomplete/);
  });
});

describe("trafficTableBlock", () => {
  it("keeps the text before the table, its header row and its separator as one head", () => {
    const block = trafficTableBlock("id", 1, "cut", "### Hosts\n\n", "| a |\n| - |\n| 1 |\n", "\n");
    expect(block.text).toBe("### Hosts\n\n| a |\n| - |\n| 1 |\n\n");
    expect(block.text.split("\n").slice(0, block.head)).toStrictEqual([
      "### Hosts",
      "",
      "| a |",
      "| - |",
    ]);
  });
});

describe("restrictExampleBlocks", () => {
  const audit = { ...universal, parameters: reportParams({ mode: "audit" }) };

  it("suggests nothing in restrict", () => {
    expect(restrictExampleBlocks(universal, "owner/repo", "v1", FIT)).toStrictEqual([]);
  });

  it("leaves no block to cut when there is no example to give", () => {
    // Otherwise a fit with no room would print a notice for an example that
    // does not exist.
    expect(restrictExampleBlocks({ ...audit, passed: [] }, "owner/repo", "v1", FIT)).toStrictEqual(
      [],
    );
  });
});

describe("communicationDetailsBlocks", () => {
  const t = 1787471975;
  const allowed: TrafficEvent = {
    time: t,
    action: "allow",
    protocol: "https",
    host: "good.com",
    port: 443,
    method: "GET",
    url: "https://good.com/pkg",
    status: 200,
    bytes: 1,
  };
  const inspect: InspectReportData = {
    engine: "inspect",
    parameters: reportParams(),
    passed: [],
    blocked: [],
    failed: [],
    blockedCount: 0,
    logLooksPlausible: true,
    ...UNINTERRUPTED,
    timeline: [],
    startedAt: t,
  };

  it("ends a line with the caller's note", () => {
    const blocked: TrafficEvent = {
      ...allowed,
      action: "block",
      reason: "not-allowed",
      status: undefined,
      bytes: undefined,
    };
    const md = joinSummaryBlocks(
      communicationDetailsBlocks({ ...inspect, timeline: [blocked, allowed] }, FIT, (e) =>
        e.action === "allow" ? "[noted]" : "",
      ),
    );
    // An empty note adds nothing, not even the space before it.
    expect(md).toContain("GET https://good.com/pkg -> not-allowed\n");
    expect(md).toContain("GET https://good.com/pkg -> 200 (1B) [noted]\n");
  });

  it("leaves no block when there is nothing to show", () => {
    expect(communicationDetailsBlocks(inspect, FIT)).toStrictEqual([]);
  });
});

describe("engineNoteBlocks", () => {
  it("notes how universal identifies a host, and inspect nothing", () => {
    expect(joinSummaryBlocks(engineNoteBlocks(universal))).toMatch(
      /^<sub>[^]*IP rules on the destination IP address\.\*<\/sub>\n$/,
    );
    expect(engineNoteBlocks({ ...universal, engine: "inspect" })).toStrictEqual([]);
  });
});

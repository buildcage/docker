import { describe, it, expect } from "vitest";

import type { TrafficEvent } from "#core/lib/log/traffic-event.ts";
import { reportParams } from "#core/lib/test/report-data.node.ts";

import { buildUniversalReportData } from "../build/universal.ts";
import type { InspectReportData, UniversalReportData } from "../types.ts";
import { describeReportOutcomes } from "./report-outcomes.ts";

function universal(overrides: Partial<UniversalReportData> = {}): UniversalReportData {
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

function inspect(
  timeline: TrafficEvent[],
  overrides: Partial<InspectReportData> = {},
): InspectReportData {
  return {
    engine: "inspect",
    parameters: reportParams(),
    passed: [],
    blocked: [],
    failed: [],
    blockedCount: 0,
    logLooksPlausible: true,
    startedAt: 1787471970,
    timeline,
    ...overrides,
  };
}

// A `no-request`, which the warning always counts. The client-ended tests below
// build their events from it.
const incomplete: TrafficEvent = {
  time: 1787471975,
  action: "incomplete",
  protocol: "https",
  host: "api.example.com",
  port: 443,
  reason: "no-request",
  destination: "198.19.255.1:443",
};

/** Two connections to one host, as the report aggregates them. */
const failedRows = [
  { host: "a.example.com", port: "443", ruleType: "HTTPS", reason: "origin-no-response", count: 2 },
];

// The blocked decision itself is blocked-outcome.ts's, tested there. What is
// left here is which emissions a report produces and in what order.
describe("describeReportOutcomes", () => {
  const options = { failOnBlocked: true, engineLabel: "proxy" } as const;

  it("always opens with the blocked-connections check, silent though it is here", () => {
    const [blocked, ...rest] = describeReportOutcomes(universal(), options);
    expect(blocked.level).toBe("none");
    expect(blocked.shouldFail).toBe(false);
    expect(rest).toStrictEqual([]);
  });

  it("names lookups in the count under universal too", async () => {
    const report = await buildUniversalReportData(
      ["buildcage haproxy starting 1787471970000"],
      [
        "2026-08-23 16:44:58.000000000  buildcage coredns starting",
        "2026-08-23 16:45:00.000000000  [INFO] buildcage dns denied name=evil.example.com.",
      ],
      reportParams(),
      0,
    );
    const [blocked] = describeReportOutcomes(report, options);
    expect(blocked.message).toBe(
      "1 blocked connection(s) and lookup(s) detected by buildcage proxy",
    );
  });

  it("says nothing more for an empty timeline", () => {
    expect(describeReportOutcomes(universal({ blockedCount: 1 }), options).length).toBe(1);
  });

  it("says nothing more for a timeline every rule could decide", () => {
    const timeline: TrafficEvent[] = [
      { time: 1787471975, action: "allow", protocol: "https", host: "a.example.com", port: 443 },
    ];
    expect(describeReportOutcomes(inspect(timeline), options).length).toBe(1);
  });

  it("warns about requests no rule decided, counting each one", () => {
    const outcomes = describeReportOutcomes(inspect([incomplete, incomplete]), options);
    expect(outcomes.length).toBe(2);
    expect(outcomes[1].level).toBe("warning");
    expect(outcomes[1].message.startsWith("2 request(s) buildcage proxy could not act on")).toBe(
      true,
    );
  });

  it("warns for universal too, whose HTTP stage logs a connection that sent no request", () => {
    const unnamed: TrafficEvent = {
      time: 1787471975,
      action: "incomplete",
      protocol: "http",
      host: "(unknown)",
      port: 25,
      reason: "client-aborted",
    };
    const outcomes = describeReportOutcomes(universal({ timeline: [unnamed] }), options);
    expect(outcomes.length).toBe(2);
    expect(outcomes[1].level).toBe("warning");
    expect(outcomes[1].shouldFail).toBe(false);
  });

  it("counts a client-ended close to a host that completed nothing, as it shows it", () => {
    // Nothing else reached the host, so the close is kept and summarised.
    const clientAborted: TrafficEvent = { ...incomplete, reason: "client-aborted" };
    const outcomes = describeReportOutcomes(inspect([clientAborted]), options);
    expect(outcomes.length).toBe(2);
    expect(outcomes[1].level).toBe("warning");
  });

  it("leaves keepalive noise out of the count, as Communication details does", () => {
    // The same host also completed a connection, so its close is only noise.
    const completed: TrafficEvent = {
      time: 1787471974,
      action: "allow",
      protocol: "https",
      host: incomplete.host,
      port: 443,
      method: "GET",
      url: `https://${incomplete.host}/pkg`,
      status: 200,
      bytes: 10,
    };
    const clientAborted: TrafficEvent = { ...incomplete, reason: "client-aborted" };
    const outcomes = describeReportOutcomes(inspect([completed, clientAborted]), options);
    expect(outcomes.length).toBe(1);
    expect(outcomes[0].level).toBe("none");
  });

  it("counts a failed client handshake even where the host completed a connection", () => {
    // Another client reaching the host does not mean this one trusts the CA.
    const completed: TrafficEvent = {
      time: 1787471974,
      action: "allow",
      protocol: "https",
      host: incomplete.host,
      port: 443,
      status: 200,
      bytes: 10,
    };
    const tlsFailed: TrafficEvent = { ...incomplete, reason: "client-tls-failed" };
    const outcomes = describeReportOutcomes(inspect([completed, tlsFailed]), options);
    expect(outcomes.length).toBe(2);
    expect(outcomes[1].level).toBe("warning");
  });

  it("never fails the step over one: no rule refused it and none can clear it", () => {
    const outcomes = describeReportOutcomes(inspect([incomplete]), options);
    expect(outcomes.every((outcome) => !outcome.shouldFail)).toBe(true);
  });

  it("names the action reporting, as the blocked message does", () => {
    const [, warning] = describeReportOutcomes(inspect([incomplete]), {
      failOnBlocked: false,
      engineLabel: "sandbox",
    });
    expect(warning.message.includes("buildcage sandbox")).toBe(true);
  });

  it("avoids the word the report already uses for a log that lost its beginning", () => {
    const [, warning] = describeReportOutcomes(inspect([incomplete]), options);
    expect(warning.message.includes("incomplete")).toBe(false);
  });

  it("notices connections that failed after the rules allowed them", () => {
    const outcomes = describeReportOutcomes(inspect([], { failed: failedRows }), options);
    expect(outcomes.length).toBe(2);
    expect(outcomes[1].level).toBe("notice");
    expect(outcomes[1].shouldFail).toBe(false);
    expect(outcomes[1].message.startsWith("2 connection(s) failed after buildcage proxy")).toBe(
      true,
    );
  });

  it("says only what happened in audit, where no rule allowed anything", () => {
    const [, notice] = describeReportOutcomes(
      inspect([], { failed: failedRows, parameters: reportParams({ mode: "audit" }) }),
      options,
    );
    expect(
      notice.message.startsWith("2 connection(s) buildcage proxy recorded did not complete"),
    ).toBe(true);
  });

  it("keeps the two asides apart when a run produced both", () => {
    const levels = describeReportOutcomes(
      inspect([incomplete], { failed: failedRows }),
      options,
    ).map((outcome) => outcome.level);
    expect(levels).toStrictEqual(["none", "warning", "notice"]);
  });

  it("notices them for universal too", () => {
    const [, notice] = describeReportOutcomes(universal({ failed: failedRows }), options);
    expect(notice.level).toBe("notice");
    expect(notice.message.startsWith("2 connection(s) failed after buildcage proxy")).toBe(true);
  });
});

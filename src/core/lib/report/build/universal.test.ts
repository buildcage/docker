import { describe, it, expect } from "vitest";

import { HEALTHY, reportParams } from "#core/lib/test/report-data.node.ts";

import { buildUniversalRestrictExample } from "../render/universal-example.ts";
import { buildUniversalReportData } from "./universal.ts";

const HAPROXY_START = "buildcage haproxy starting 1787471970000";
const DNS_START = "2026-08-23 16:44:58.000000000  buildcage coredns starting";

/** A proxy decision line in the universal engine's log-format. */
const proxy = (
  decision: string,
  ruleType: string,
  target: string,
  reason: string,
  bytes: string | number = 0,
  ms = 1787471971000,
) => `buildcage ${ms} [${decision}] (${ruleType}) "${target}" ${reason} ${bytes}`;

const dnsLine = (verb: string, name: string, type?: string) =>
  `2026-08-23 16:45:00.000000000  [INFO] buildcage dns ${verb} name=${name}.${
    type ? ` type=${type}` : ""
  }`;

describe("buildUniversalReportData", () => {
  it("reads allowed and blocked proxy connections into the host tables and timeline", async () => {
    const result = await buildUniversalReportData(
      [
        HAPROXY_START,
        proxy("ALLOWED", "HTTPS", "good.com:443", "-", 1200),
        proxy("BLOCKED", "HTTP", "bad.com:80", "not-allowed"),
      ],
      [DNS_START],
      reportParams(),
      HEALTHY,
    );
    expect(result.engine).toBe("universal");
    expect(result.passed.map((r) => r.host)).toStrictEqual(["good.com"]);
    expect(result.blocked.map((r) => r.host)).toStrictEqual(["bad.com"]);
    expect(result.blockedCount).toBe(1);
    expect(result.timeline.length).toBe(2);
    expect(result.startedAt).toBe(1787471970);
    expect(result.logLooksPlausible).toBe(true);
  });

  it("records audited connections in audit mode", async () => {
    const result = await buildUniversalReportData(
      [HAPROXY_START, proxy("AUDIT", "HTTPS", "any.com:443", "-", 10)],
      [DNS_START],
      reportParams({ mode: "audit" }),
      HEALTHY,
    );
    expect(result.passed.map((r) => r.host)).toStrictEqual(["any.com"]);
  });

  it("folds a host spelled in different case into one row and one example rule", async () => {
    const result = await buildUniversalReportData(
      [
        HAPROXY_START,
        proxy("AUDIT", "HTTPS", "Example.com:443", "-", 10),
        proxy("AUDIT", "HTTPS", "example.com:443", "-", 10),
      ],
      [DNS_START],
      reportParams({ mode: "audit" }),
      HEALTHY,
    );
    expect(result.passed.map((r) => [r.host, r.count])).toStrictEqual([["example.com", 2]]);
    expect(
      buildUniversalRestrictExample(result.passed, "owner/repo").match(/example\.com:443/g),
    ).toStrictEqual(["example.com:443"]);
  });

  it("tables a dns-failed connection apart from blocks", async () => {
    const result = await buildUniversalReportData(
      [HAPROXY_START, proxy("BLOCKED", "HTTPS", "absent.com:443", "dns-failed")],
      [DNS_START],
      reportParams(),
      HEALTHY,
    );
    expect(result.failed.map((r) => r.host)).toStrictEqual(["absent.com"]);
    expect(result.blocked.length).toBe(0);
  });

  it("adds a blocked resolver name as a DNS blocked row that fails the step", async () => {
    const result = await buildUniversalReportData(
      [HAPROXY_START],
      [DNS_START, dnsLine("denied", "exfil.attacker.example")],
      reportParams(),
      HEALTHY,
    );
    expect(result.blocked[0].host).toBe("exfil.attacker.example");
    expect(result.blocked[0].ruleType).toBe("DNS");
    expect(result.blocked[0].port).toBe("-");
    expect(result.blockedCount).toBe(1);
  });

  it("adds a blocked service name as a DNS blocked row", async () => {
    const result = await buildUniversalReportData(
      [HAPROXY_START],
      [DNS_START, dnsLine("service-denied", "_mongodb._tcp.c0.example.net", "SRV")],
      reportParams(),
      HEALTHY,
    );
    expect(result.blocked[0].host).toBe("_mongodb._tcp.c0.example.net");
    expect(result.blocked[0].ruleType).toBe("DNS");
  });

  it("records an allowed-only lookup as a DNS passed row in audit", async () => {
    const result = await buildUniversalReportData(
      [HAPROXY_START],
      [DNS_START, dnsLine("allowed", "looked-up.example.com")],
      reportParams({ mode: "audit" }),
      HEALTHY,
    );
    expect(result.passed[0].host).toBe("looked-up.example.com");
    expect(result.passed[0].ruleType).toBe("DNS");
  });

  it("keeps a discovery lookup out of the host tables but in the timeline", async () => {
    const result = await buildUniversalReportData(
      [HAPROXY_START],
      [DNS_START, dnsLine("discovery", "_http._tcp.deb.debian.org", "SRV")],
      reportParams({ mode: "audit" }),
      HEALTHY,
    );
    expect(result.passed).toStrictEqual([]);
    expect(result.blocked).toStrictEqual([]);
    expect(result.timeline.some((e) => e.action === "discovery")).toBe(true);
  });

  it("does not double a lookup the build then connected on", async () => {
    const result = await buildUniversalReportData(
      [HAPROXY_START, proxy("ALLOWED", "HTTPS", "good.com:443", "-", 8)],
      [DNS_START, dnsLine("allowed", "good.com")],
      reportParams(),
      HEALTHY,
    );
    expect(result.passed.length).toBe(1);
    expect(result.passed[0].ruleType).toBe("HTTPS");
  });

  it("marks a DNS blocked row expected via a host:* known_blocked_rule", async () => {
    const result = await buildUniversalReportData(
      [HAPROXY_START],
      [DNS_START, dnsLine("denied", "telemetry.example.com")],
      reportParams({ knownBlockedRules: ["telemetry.example.com:*"] }),
      HEALTHY,
    );
    expect(result.blocked[0].expected).toBe(true);
  });

  it("orders the timeline oldest first across proxy and resolver events", async () => {
    const result = await buildUniversalReportData(
      [HAPROXY_START, proxy("ALLOWED", "HTTPS", "b.com:443", "-", 1, 1787471973000)],
      [DNS_START, dnsLine("denied", "a.example")],
      reportParams(),
      HEALTHY,
    );
    const times = result.timeline.map((e) => e.time);
    expect(times).toStrictEqual([...times].sort((x, y) => x - y));
  });

  it("logLooksPlausible is false when the resolver log's beginning is gone", async () => {
    const result = await buildUniversalReportData(
      [HAPROXY_START, proxy("ALLOWED", "HTTPS", "good.com:443", "-", 1)],
      [dnsLine("allowed", "good.com")],
      reportParams(),
      HEALTHY,
    );
    expect(result.logLooksPlausible).toBe(false);
  });

  it("logLooksPlausible is false when a resolver decision line could not be read", async () => {
    // A blocked name reaches no proxy, so an unreadable line is a block lost.
    const result = await buildUniversalReportData(
      [HAPROXY_START],
      [DNS_START, dnsLine("denied", "bad com")],
      reportParams(),
      HEALTHY,
    );
    expect(result.logLooksPlausible).toBe(false);
  });

  it("logLooksPlausible is false when a proxy decision line could not be read", async () => {
    const result = await buildUniversalReportData(
      [HAPROXY_START, `buildcage 1787471971000 [BLOCKED] (HTTPS) "bad.com:4`],
      [DNS_START],
      reportParams(),
      HEALTHY,
    );
    expect(result.logLooksPlausible).toBe(false);
  });

  it.each([
    { droppedLogs: { answered: true, count: 1 }, what: "dropped a line" },
    {
      droppedLogs: { answered: true, count: undefined },
      what: "could not say whether it dropped one",
    },
    { droppedLogs: { answered: false, count: undefined }, what: "did not answer" },
  ])("logLooksPlausible is false when the proxy $what", async ({ droppedLogs }) => {
    // A dropped line leaves no gap either log shows, so only the count can
    // tell a whole log from one a flood thinned out.
    const result = await buildUniversalReportData(
      [HAPROXY_START, proxy("ALLOWED", "HTTPS", "good.com:443", "-", 1)],
      [DNS_START],
      reportParams(),
      { ...HEALTHY, droppedLogs },
    );
    expect(result.logLooksPlausible).toBe(false);
    expect(result.proxyAnswered).toBe(droppedLogs.answered);
    expect(result.passed.map((r) => r.host)).toStrictEqual(["good.com"]);
  });

  it("logLooksPlausible is false when the resolver did not answer", async () => {
    // Lookups a stopped resolver never received leave no line in its log.
    const result = await buildUniversalReportData(
      [HAPROXY_START, proxy("ALLOWED", "HTTPS", "good.com:443", "-", 1)],
      [DNS_START],
      reportParams(),
      { ...HEALTHY, resolverAnswered: false },
    );
    expect(result.logLooksPlausible).toBe(false);
    expect(result.resolverAnswered).toBe(false);
    expect(result.proxyAnswered).toBe(true);
  });

  it("logLooksPlausible is false when the proxy restarted", async () => {
    const allowed = proxy("ALLOWED", "HTTPS", "good.com:443", "-", 1);
    const result = await buildUniversalReportData(
      [HAPROXY_START, allowed, HAPROXY_START, allowed],
      [DNS_START],
      reportParams(),
      HEALTHY,
    );
    expect(result.restarts).toStrictEqual({ proxy: 1, resolver: 0 });
    expect(result.logLooksPlausible).toBe(false);
  });

  it("returns empty tables and an implausible log for empty input", async () => {
    const result = await buildUniversalReportData([], [], reportParams(), HEALTHY);
    expect(result.passed).toStrictEqual([]);
    expect(result.blocked).toStrictEqual([]);
    expect(result.timeline).toStrictEqual([]);
    expect(result.logLooksPlausible).toBe(false);
  });
});

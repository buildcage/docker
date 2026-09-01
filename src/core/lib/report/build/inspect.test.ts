import { describe, it, expect, reportResults } from "#core/lib/test/test-shim.ts";
import { buildInspectReportData } from "./inspect.ts";
import type { GenReportParameters } from "../types.ts";

const START = "buildcage haproxy starting 1787471970000";
const ALLOWED =
  "buildcage 1787471975 https GET https://registry.npmjs.org/pkg 200 708 ts=-- dst=104.16.1.34:443";
const REFUSED =
  "buildcage 1787471976 https POST https://evil.example.com/exfil?d=SECRET 403 0 ts=PR dst=1.2.3.4:443";
const TLS_PASS = "buildcage 1787471977 pass tls sni=db.example.com 3421 ts=-- dst=10.0.0.9:5432";

const PARAMS: GenReportParameters = {
  mode: "restrict",
  allowedHttpsRules: [],
  allowedHttpRules: [],
  allowedIpRules: [],
  allowTlsRules: [],
  knownBlockedRules: [],
};

function params(overrides: Partial<GenReportParameters> = {}): GenReportParameters {
  return { ...PARAMS, ...overrides };
}

describe("buildInspectReportData", () => {
  it("puts everything in one timeline, oldest first", async () => {
    const dns = ["2026-08-23 16:45:00.000000000  [INFO] buildcage dns denied name=z.example.com."];
    const r = await buildInspectReportData([START, REFUSED, ALLOWED, TLS_PASS], dns, params());
    expect(r.timeline.length).toBe(4);
    expect(r.timeline.every((e, i) => i === 0 || r.timeline[i - 1].time <= e.time)).toBe(true);
  });

  it("aggregates each side into host rows a rule could be written from", async () => {
    const r = await buildInspectReportData([START, ALLOWED, REFUSED], [], params());
    expect(r.passed[0].host).toBe("registry.npmjs.org");
    expect(r.passed[0].port).toBe("443");
    expect(r.passed[0].ruleType).toBe("HTTPS");
    expect(r.blocked[0].host).toBe("evil.example.com");
    expect(r.blocked[0].reason).toBe("not-allowed");
  });

  it("drops a blocked DNS row from the tables once the same host's request is also blocked", async () => {
    // evil.example.com is REFUSED's host: the DNS-only record adds nothing a
    // reader could not already tell from the request row.
    const dns = [
      "2026-08-23 16:45:00.000000000  [INFO] buildcage dns denied name=evil.example.com.",
    ];
    const r = await buildInspectReportData([START, REFUSED], dns, params());
    expect(r.blocked.length).toBe(1);
    expect(r.blocked[0].ruleType).toBe("HTTPS");
    // The raw timeline is untouched -- only the host tables collapse it.
    expect(r.timeline.some((e) => e.protocol === "dns")).toBe(true);
  });

  it("keeps a blocked DNS row when the name was never actually requested", async () => {
    const dns = [
      "2026-08-23 16:45:00.000000000  [INFO] buildcage dns denied name=secret-in-a-name.attacker.example.",
    ];
    const r = await buildInspectReportData([START], dns, params());
    expect(r.blocked.length).toBe(1);
    expect(r.blocked[0].ruleType).toBe("DNS");
  });

  it("gives a passthrough the rule kind that would permit it", async () => {
    const r = await buildInspectReportData([START, TLS_PASS], [], params());
    expect(r.passed[0].ruleType).toBe("TLS");
    expect(r.passed[0].host).toBe("db.example.com");
    expect(r.passed[0].port).toBe("5432");
  });

  it("does not count an origin's own 403 as blocked", async () => {
    // fail_on_blocked defaults to true, so a registry answering 403 to an
    // unauthenticated fetch would otherwise fail a build that was not blocked.
    const relayed =
      "buildcage 3 https GET https://reg.example.com/pkg 403 90 ts=-- dst=1.1.1.1:443";
    const r = await buildInspectReportData([START, relayed], [], params());
    expect(r.blockedCount).toBe(0);
  });

  it("counts every blocked event, not just the distinct hosts", async () => {
    const r = await buildInspectReportData([START, REFUSED, REFUSED], [], params());
    expect(r.blocked.length).toBe(1);
    expect(r.blockedCount).toBe(2);
  });

  it("reports a name the resolver refused, which never reached the proxy", async () => {
    // Otherwise exfiltration through the query alone would leave no trace.
    const dns = [
      "2026-08-23 16:45:00.000000000  [INFO] buildcage dns denied name=SECRET.att.example.",
    ];
    const r = await buildInspectReportData([START], dns, params());
    expect(r.blocked[0].ruleType).toBe("DNS");
    expect(r.blocked[0].reason).toBe("dns-not-allowed");
    expect(r.blockedCount).toBe(1);
  });

  it("keeps a resolved name out of the host tables", async () => {
    // The request that followed is already a row; listing both doubles it.
    const dns = [
      "2026-08-23 16:45:00.000000000  [INFO] buildcage dns allowed name=registry.npmjs.org.",
    ];
    const r = await buildInspectReportData([START, ALLOWED], dns, params());
    expect(r.passed.length).toBe(1);
    // It is still in the timeline, which the job output is built from.
    expect(r.timeline.filter((e) => e.protocol === "dns").length).toBe(1);
  });

  it("lets a refused name be declared expected", async () => {
    // The row has no port, so without special handling no writable rule could
    // ever match it and fail_on_blocked would fail the job with no way out.
    const dns = [
      "2026-08-23 16:45:00.000000000  [INFO] buildcage dns denied name=telemetry.example.com.",
    ];
    const r = await buildInspectReportData(
      [START],
      dns,
      params({ knownBlockedRules: ["telemetry.example.com:*"] }),
    );
    expect(r.blocked[0].expected).toBe(true);
  });

  it("marks everything as audited when nothing was being enforced", async () => {
    const r = await buildInspectReportData([START, ALLOWED], [], params({ mode: "audit" }));
    expect(r.timeline[0].action).toBe("audit");
  });

  it("fails closed on a log with no startup marker", async () => {
    // An empty log means either "saw nothing" or "never ran"; only the marker
    // tells them apart, and reporting "nothing was blocked" for a proxy that
    // never started would be the dangerous reading.
    const missing = await buildInspectReportData([], [], params());
    expect(missing.logLooksPlausible).toBe(false);
    expect(missing.startedAt === undefined).toBe(true);

    const present = await buildInspectReportData([START], [], params());
    expect(present.logLooksPlausible).toBe(true);
    expect(present.startedAt).toBe(1787471970);
  });
});

reportResults();

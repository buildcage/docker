import { describe, it, expect, reportResults } from "#core/lib/test/test-shim.ts";
import { buildTransparentReportData } from "./transparent.ts";
import type { GenReportParameters } from "../types.ts";

function params(overrides: Partial<GenReportParameters> = {}): GenReportParameters {
  return {
    mode: "restrict",
    allowedHttpsRules: [],
    allowedHttpRules: [],
    allowedIpRules: [],
    knownBlockedRules: [],
    ...overrides,
  };
}

describe("buildTransparentReportData", () => {
  it("aggregates allowed/blocked in restrict mode", async () => {
    const log = [
      '[2024-01-01T00:00:00] buildcage [ALLOWED] (HTTPS) "good.com:443" -',
      '[2024-01-01T00:00:00] buildcage [BLOCKED] (HTTP) "bad.com:80" not-allowed',
    ].join("\n");
    const result = await buildTransparentReportData(log.split("\n"), params());
    expect(result.engine).toBe("transparent");
    expect(result.passed.length).toBe(1);
    expect(result.passed[0].host).toBe("good.com");
    expect(result.blocked.length).toBe(1);
    expect(result.blocked[0].host).toBe("bad.com");
    expect(result.blockedCount).toBe(1);
  });

  it("aggregates audited traffic in audit mode instead of allowed", async () => {
    const log = '[2024-01-01T00:00:00] buildcage [AUDIT] (HTTPS) "any.com:443"';
    const result = await buildTransparentReportData(log.split("\n"), params({ mode: "audit" }));
    expect(result.passed.length).toBe(1);
    expect(result.passed[0].host).toBe("any.com");
  });

  it("annotates blocked rows against knownBlockedRules", async () => {
    const log =
      '[2024-01-01T00:00:00] buildcage [BLOCKED] (HTTPS) "noisy.example.com:443" not-allowed';
    const result = await buildTransparentReportData(
      log.split("\n"),
      params({ knownBlockedRules: ["noisy.example.com:443"] }),
    );
    expect(result.blocked[0].expected).toBe(true);
  });

  it("returns empty passed/blocked and blockedCount 0 for empty log text", async () => {
    const result = await buildTransparentReportData("".split("\n"), params());
    expect(result.passed).toStrictEqual([]);
    expect(result.blocked).toStrictEqual([]);
    expect(result.blockedCount).toBe(0);
    expect(result.logLooksPlausible).toBe(false);
  });

  it("logLooksPlausible is true for a genuinely quiet run (HAProxy's own startup noise, zero blocked)", async () => {
    const log = [
      "[NOTICE]   (1) : haproxy version is 2.9.0",
      '[2024-01-01T00:00:00] buildcage [ALLOWED] (HTTPS) "good.com:443" -',
    ].join("\n");
    const result = await buildTransparentReportData(log.split("\n"), params());
    expect(result.blockedCount).toBe(0);
    expect(result.logLooksPlausible).toBe(true);
  });

  it("blockedCount counts raw events, not aggregated rows", async () => {
    const log = [
      '[2024-01-01T00:00:00] buildcage [BLOCKED] (HTTPS) "bad.com:443" not-allowed',
      '[2024-01-01T00:00:01] buildcage [BLOCKED] (HTTPS) "bad.com:443" not-allowed',
    ].join("\n");
    const result = await buildTransparentReportData(log.split("\n"), params());
    expect(result.blockedCount).toBe(2);
    expect(result.blocked.length).toBe(1);
    expect(result.blocked[0].count).toBe(2);
  });
});

reportResults();

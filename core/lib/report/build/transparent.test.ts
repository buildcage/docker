import { describe, it, assert, reportResults } from "../../test/test-shim.ts";
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
    assert.equal(result.engine, "transparent");
    assert.equal(result.passed.length, 1);
    assert.equal(result.passed[0].host, "good.com");
    assert.equal(result.blocked.length, 1);
    assert.equal(result.blocked[0].host, "bad.com");
    assert.equal(result.blockedCount, 1);
  });

  it("aggregates audited traffic in audit mode instead of allowed", async () => {
    const log = '[2024-01-01T00:00:00] buildcage [AUDIT] (HTTPS) "any.com:443"';
    const result = await buildTransparentReportData(log.split("\n"), params({ mode: "audit" }));
    assert.equal(result.passed.length, 1);
    assert.equal(result.passed[0].host, "any.com");
  });

  it("annotates blocked rows against knownBlockedRules", async () => {
    const log =
      '[2024-01-01T00:00:00] buildcage [BLOCKED] (HTTPS) "noisy.example.com:443" not-allowed';
    const result = await buildTransparentReportData(
      log.split("\n"),
      params({ knownBlockedRules: ["noisy.example.com:443"] }),
    );
    assert.equal(result.blocked[0].expected, true);
  });

  it("returns empty passed/blocked and blockedCount 0 for empty log text", async () => {
    const result = await buildTransparentReportData("".split("\n"), params());
    assert.deepEqual(result.passed, []);
    assert.deepEqual(result.blocked, []);
    assert.equal(result.blockedCount, 0);
    assert.equal(result.logLooksPlausible, false);
  });

  it("logLooksPlausible is true for a genuinely quiet run (HAProxy's own startup noise, zero blocked)", async () => {
    const log = [
      "[NOTICE]   (1) : haproxy version is 2.9.0",
      '[2024-01-01T00:00:00] buildcage [ALLOWED] (HTTPS) "good.com:443" -',
    ].join("\n");
    const result = await buildTransparentReportData(log.split("\n"), params());
    assert.equal(result.blockedCount, 0);
    assert.equal(result.logLooksPlausible, true);
  });

  it("blockedCount counts raw events, not aggregated rows", async () => {
    const log = [
      '[2024-01-01T00:00:00] buildcage [BLOCKED] (HTTPS) "bad.com:443" not-allowed',
      '[2024-01-01T00:00:01] buildcage [BLOCKED] (HTTPS) "bad.com:443" not-allowed',
    ].join("\n");
    const result = await buildTransparentReportData(log.split("\n"), params());
    assert.equal(result.blockedCount, 2);
    assert.equal(result.blocked.length, 1);
    assert.equal(result.blocked[0].count, 2);
  });
});

reportResults();

import { describe, it, assert, reportResults } from "../test/test-shim.ts";
import { scanHaproxyLog } from "./haproxy.ts";

// ---------------------------------------------------------------------------
// scanHaproxyLog
// ---------------------------------------------------------------------------
describe("scanHaproxyLog", () => {
  it("aggregates an ALLOWED log line as passed when isAudit is false", async () => {
    const log = '[2024-01-01T00:00:00] buildcage [ALLOWED] (HTTPS) "example.com:443" rule1';
    const result = await scanHaproxyLog(log.split("\n"), false);
    assert.equal(result.passed.length, 1);
    assert.equal(result.passed[0].ruleType, "HTTPS");
    assert.equal(result.passed[0].host, "example.com");
    assert.equal(result.passed[0].port, "443");
    assert.equal(result.passed[0].reason, "rule1");
    assert.equal(result.blocked.length, 0);
  });

  it("aggregates a BLOCKED log line regardless of isAudit", async () => {
    const log = '[2024-01-01T00:00:00] buildcage [BLOCKED] (HTTP) "bad.com:80" not-allowed';
    const result = await scanHaproxyLog(log.split("\n"), false);
    assert.equal(result.blocked.length, 1);
    assert.equal(result.blocked[0].reason, "not-allowed");
    assert.equal(result.blockedCount, 1);
  });

  it("aggregates an AUDIT log line as passed when isAudit is true", async () => {
    const log = '[2024-01-01T00:00:00] buildcage [AUDIT] (HTTPS) "any.com:443"';
    const result = await scanHaproxyLog(log.split("\n"), true);
    assert.equal(result.passed.length, 1);
    assert.equal(result.passed[0].reason, "-");
  });

  it("drops an ALLOWED line when isAudit is true (not the decision this mode aggregates)", async () => {
    const log = '[2024-01-01T00:00:00] buildcage [ALLOWED] (HTTPS) "example.com:443" rule1';
    const result = await scanHaproxyLog(log.split("\n"), true);
    assert.equal(result.passed.length, 0);
  });

  it("drops an AUDIT line when isAudit is false (not the decision this mode aggregates)", async () => {
    const log = '[2024-01-01T00:00:00] buildcage [AUDIT] (HTTPS) "any.com:443"';
    const result = await scanHaproxyLog(log.split("\n"), false);
    assert.equal(result.passed.length, 0);
  });

  it("ignores non-matching lines without counting them anywhere", async () => {
    const log = "some random log line\n[2024-01-01] other stuff";
    const result = await scanHaproxyLog(log.split("\n"), false);
    assert.equal(result.passed.length, 0);
    assert.equal(result.blocked.length, 0);
  });

  it("aggregates repeated BLOCKED lines into one row, but keeps blockedCount raw", async () => {
    const log = [
      '[2024-01-01T00:00:00] buildcage [BLOCKED] (HTTPS) "bad.com:443" not-allowed',
      '[2024-01-01T00:00:01] buildcage [BLOCKED] (HTTPS) "bad.com:443" not-allowed',
    ].join("\n");
    const result = await scanHaproxyLog(log.split("\n"), false);
    assert.equal(result.blocked.length, 1);
    assert.equal(result.blocked[0].count, 2);
    assert.equal(result.blockedCount, 2);
  });

  it("keeps passed/blocked buckets independent across mixed lines", async () => {
    const log = [
      '[2024-01-01T00:00:00] buildcage [ALLOWED] (HTTPS) "a.com:443" r1',
      '[2024-01-01T00:00:01] buildcage [BLOCKED] (HTTP) "b.com:80" not-allowed',
      "not a log line",
      '[2024-01-01T00:00:02] buildcage [ALLOWED] (HTTPS) "a.com:443" r1',
    ].join("\n");
    const result = await scanHaproxyLog(log.split("\n"), false);
    assert.equal(result.passed.length, 1);
    assert.equal(result.passed[0].count, 2);
    assert.equal(result.blocked.length, 1);
    assert.equal(result.blockedCount, 1);
  });

  it("accepts a real AsyncIterable, not just an array", async () => {
    async function* lines(): AsyncGenerator<string> {
      yield '[2024-01-01T00:00:00] buildcage [ALLOWED] (HTTPS) "async.com:443" r1';
    }
    const result = await scanHaproxyLog(lines(), false);
    assert.equal(result.passed.length, 1);
    assert.equal(result.passed[0].host, "async.com");
  });

  // ---------------------------------------------------------------------
  // hasNonBuildcageContent
  // ---------------------------------------------------------------------
  it("hasNonBuildcageContent is false for empty log text", async () => {
    const result = await scanHaproxyLog("".split("\n"), false);
    assert.equal(result.hasNonBuildcageContent, false);
  });

  it("hasNonBuildcageContent is false when the log has only buildcage-decision lines", async () => {
    const log = [
      '[2024-01-01T00:00:00] buildcage [ALLOWED] (HTTPS) "a.com:443" r1',
      '[2024-01-01T00:00:01] buildcage [BLOCKED] (HTTP) "b.com:80" not-allowed',
    ].join("\n");
    const result = await scanHaproxyLog(log.split("\n"), false);
    assert.equal(result.hasNonBuildcageContent, false);
  });

  it("hasNonBuildcageContent is true when the log contains HAProxy's own non-decision output", async () => {
    const log = [
      "[NOTICE]   (1) : haproxy version is 2.9.0",
      '[2024-01-01T00:00:00] buildcage [ALLOWED] (HTTPS) "a.com:443" r1',
    ].join("\n");
    const result = await scanHaproxyLog(log.split("\n"), false);
    assert.equal(result.hasNonBuildcageContent, true);
  });

  it("hasNonBuildcageContent ignores blank lines when deciding", async () => {
    const result = await scanHaproxyLog("\n\n  \n".split("\n"), false);
    assert.equal(result.hasNonBuildcageContent, false);
  });
});

reportResults();

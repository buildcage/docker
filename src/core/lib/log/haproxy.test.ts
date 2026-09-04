import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import { scanHaproxyLog } from "./haproxy.ts";

// ---------------------------------------------------------------------------
// scanHaproxyLog
// ---------------------------------------------------------------------------
describe("scanHaproxyLog", () => {
  it("aggregates an ALLOWED log line as passed when isAudit is false", async () => {
    const log = '[2024-01-01T00:00:00] buildcage [ALLOWED] (HTTPS) "example.com:443" rule1';
    const result = await scanHaproxyLog(log.split("\n"), false);
    expect(result.passed.length).toBe(1);
    expect(result.passed[0].ruleType).toBe("HTTPS");
    expect(result.passed[0].host).toBe("example.com");
    expect(result.passed[0].port).toBe("443");
    expect(result.passed[0].reason).toBe("rule1");
    expect(result.blocked.length).toBe(0);
  });

  it("aggregates a BLOCKED log line regardless of isAudit", async () => {
    const log = '[2024-01-01T00:00:00] buildcage [BLOCKED] (HTTP) "bad.com:80" not-allowed';
    const result = await scanHaproxyLog(log.split("\n"), false);
    expect(result.blocked.length).toBe(1);
    expect(result.blocked[0].reason).toBe("not-allowed");
    expect(result.blockedCount).toBe(1);
  });

  it("aggregates an AUDIT log line as passed when isAudit is true", async () => {
    const log = '[2024-01-01T00:00:00] buildcage [AUDIT] (HTTPS) "any.com:443"';
    const result = await scanHaproxyLog(log.split("\n"), true);
    expect(result.passed.length).toBe(1);
    expect(result.passed[0].reason).toBe("-");
  });

  it("drops an ALLOWED line when isAudit is true (not the decision this mode aggregates)", async () => {
    const log = '[2024-01-01T00:00:00] buildcage [ALLOWED] (HTTPS) "example.com:443" rule1';
    const result = await scanHaproxyLog(log.split("\n"), true);
    expect(result.passed.length).toBe(0);
  });

  it("drops an AUDIT line when isAudit is false (not the decision this mode aggregates)", async () => {
    const log = '[2024-01-01T00:00:00] buildcage [AUDIT] (HTTPS) "any.com:443"';
    const result = await scanHaproxyLog(log.split("\n"), false);
    expect(result.passed.length).toBe(0);
  });

  it("ignores non-matching lines without counting them anywhere", async () => {
    const log = "some random log line\n[2024-01-01] other stuff";
    const result = await scanHaproxyLog(log.split("\n"), false);
    expect(result.passed.length).toBe(0);
    expect(result.blocked.length).toBe(0);
  });

  it("aggregates repeated BLOCKED lines into one row, but keeps blockedCount raw", async () => {
    const log = [
      '[2024-01-01T00:00:00] buildcage [BLOCKED] (HTTPS) "bad.com:443" not-allowed',
      '[2024-01-01T00:00:01] buildcage [BLOCKED] (HTTPS) "bad.com:443" not-allowed',
    ].join("\n");
    const result = await scanHaproxyLog(log.split("\n"), false);
    expect(result.blocked.length).toBe(1);
    expect(result.blocked[0].count).toBe(2);
    expect(result.blockedCount).toBe(2);
  });

  it("keeps passed/blocked buckets independent across mixed lines", async () => {
    const log = [
      '[2024-01-01T00:00:00] buildcage [ALLOWED] (HTTPS) "a.com:443" r1',
      '[2024-01-01T00:00:01] buildcage [BLOCKED] (HTTP) "b.com:80" not-allowed',
      "not a log line",
      '[2024-01-01T00:00:02] buildcage [ALLOWED] (HTTPS) "a.com:443" r1',
    ].join("\n");
    const result = await scanHaproxyLog(log.split("\n"), false);
    expect(result.passed.length).toBe(1);
    expect(result.passed[0].count).toBe(2);
    expect(result.blocked.length).toBe(1);
    expect(result.blockedCount).toBe(1);
  });

  it("accepts a real AsyncIterable, not just an array", async () => {
    async function* lines(): AsyncGenerator<string> {
      yield '[2024-01-01T00:00:00] buildcage [ALLOWED] (HTTPS) "async.com:443" r1';
    }
    const result = await scanHaproxyLog(lines(), false);
    expect(result.passed.length).toBe(1);
    expect(result.passed[0].host).toBe("async.com");
  });

  // ---------------------------------------------------------------------
  // hasNonBuildcageContent
  // ---------------------------------------------------------------------
  it("hasNonBuildcageContent is false for empty log text", async () => {
    const result = await scanHaproxyLog("".split("\n"), false);
    expect(result.hasNonBuildcageContent).toBe(false);
  });

  it("hasNonBuildcageContent is false when the log has only buildcage-decision lines", async () => {
    const log = [
      '[2024-01-01T00:00:00] buildcage [ALLOWED] (HTTPS) "a.com:443" r1',
      '[2024-01-01T00:00:01] buildcage [BLOCKED] (HTTP) "b.com:80" not-allowed',
    ].join("\n");
    const result = await scanHaproxyLog(log.split("\n"), false);
    expect(result.hasNonBuildcageContent).toBe(false);
  });

  it("hasNonBuildcageContent is true when the log contains HAProxy's own non-decision output", async () => {
    const log = [
      "[NOTICE]   (1) : haproxy version is 2.9.0",
      '[2024-01-01T00:00:00] buildcage [ALLOWED] (HTTPS) "a.com:443" r1',
    ].join("\n");
    const result = await scanHaproxyLog(log.split("\n"), false);
    expect(result.hasNonBuildcageContent).toBe(true);
  });

  it("hasNonBuildcageContent is true for a zero-traffic run thanks to the guaranteed startup marker", async () => {
    // See docker/universal/files/s6-rc.d/haproxy/run
    const result = await scanHaproxyLog(["buildcage haproxy starting"], false);
    expect(result.hasNonBuildcageContent).toBe(true);
    expect(result.blockedCount).toBe(0);
  });

  it("hasNonBuildcageContent ignores blank lines when deciding", async () => {
    const result = await scanHaproxyLog("\n\n  \n".split("\n"), false);
    expect(result.hasNonBuildcageContent).toBe(false);
  });

  // ---------------------------------------------------------------------
  // Log injection via an unsanitized target/reason
  // ---------------------------------------------------------------------
  it("a quote inside the target field does not match, and counts as non-buildcage content", async () => {
    const log =
      '[2024-01-01T00:00:00] buildcage [ALLOWED] (HTTPS) "evil"] buildcage [ALLOWED] (HTTPS) "a.com:443" r1';
    const result = await scanHaproxyLog(log.split("\n"), false);
    expect(result.passed.length).toBe(0);
    expect(result.hasNonBuildcageContent).toBe(true);
  });

  it("a well-formed line with extra content appended after it does not match", async () => {
    const log =
      '[2024-01-01T00:00:00] buildcage [ALLOWED] (HTTPS) "a.com:443" r1 [2024-01-01T00:00:01] buildcage [BLOCKED] (HTTPS) "hidden.com:443" not-allowed';
    const result = await scanHaproxyLog(log.split("\n"), false);
    expect(result.passed.length).toBe(0);
    expect(result.blocked.length).toBe(0);
    expect(result.hasNonBuildcageContent).toBe(true);
  });
});

reportResults();

import { describe, it, assert, reportResults } from "./test-shim.js";
import { parseEntries } from "./log-parser.js";

// ---------------------------------------------------------------------------
// parseEntries
// ---------------------------------------------------------------------------
describe("parseEntries", () => {
  it("parses ALLOWED log line", () => {
    const log = '[2024-01-01T00:00:00] buildcage [ALLOWED] (HTTPS) "example.com:443" rule1';
    const entries = parseEntries(log);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].decision, "ALLOWED");
    assert.equal(entries[0].ruleType, "HTTPS");
    assert.equal(entries[0].host, "example.com");
    assert.equal(entries[0].port, "443");
    assert.equal(entries[0].reason, "rule1");
  });

  it("parses BLOCKED log line", () => {
    const log = '[2024-01-01T00:00:00] buildcage [BLOCKED] (HTTP) "bad.com:80" not-allowed';
    const entries = parseEntries(log);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].decision, "BLOCKED");
    assert.equal(entries[0].reason, "not-allowed");
  });

  it("parses AUDIT log line", () => {
    const log = '[2024-01-01T00:00:00] buildcage [AUDIT] (HTTPS) "any.com:443"';
    const entries = parseEntries(log);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].decision, "AUDIT");
    assert.equal(entries[0].reason, "-");
  });

  it("ignores non-matching lines", () => {
    const log = "some random log line\n[2024-01-01] other stuff";
    const entries = parseEntries(log);
    assert.equal(entries.length, 0);
  });

  it("parses multiple lines", () => {
    const log = [
      '[2024-01-01T00:00:00] buildcage [ALLOWED] (HTTPS) "a.com:443" r1',
      '[2024-01-01T00:00:01] buildcage [BLOCKED] (HTTP) "b.com:80" not-allowed',
      'not a log line',
      '[2024-01-01T00:00:02] buildcage [ALLOWED] (HTTPS) "a.com:443" r1',
    ].join("\n");
    const entries = parseEntries(log);
    assert.equal(entries.length, 3);
  });
});

// aggregate() is tested in docker/shared/tools/lib/aggregate.test.js.

// ---------------------------------------------------------------------------
// mode detection
// ---------------------------------------------------------------------------
describe("mode detection", () => {
  it("detects audit mode", () => {
    const entries = parseEntries('[2024-01-01T00:00:00] buildcage [AUDIT] (HTTPS) "a.com:443"');
    const isAudit = entries.some(e => e.decision === "AUDIT");
    assert.ok(isAudit);
  });

  it("detects restrict mode", () => {
    const entries = parseEntries('[2024-01-01T00:00:00] buildcage [ALLOWED] (HTTPS) "a.com:443" r1');
    const isAudit = entries.some(e => e.decision === "AUDIT");
    assert.ok(!isAudit);
  });
});

reportResults();

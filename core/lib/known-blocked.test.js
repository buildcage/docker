import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseKnownBlockedRules,
  annotateKnownBlocked,
  determineBlockedOutcome,
  buildBlockedMessage,
} from "./known-blocked.js";

describe("parseKnownBlockedRules", () => {
  it("parses whitespace-separated rules", () => {
    assert.deepEqual(
      parseKnownBlockedRules("a.example.com:443 b.example.com:80"),
      ["a.example.com:443", "b.example.com:80"],
    );
  });

  it("returns an empty array for undefined input", () => {
    assert.deepEqual(parseKnownBlockedRules(undefined), []);
  });

  it("returns an empty array for empty/whitespace-only input", () => {
    assert.deepEqual(parseKnownBlockedRules("   "), []);
  });

  it("throws on invalid wildcard syntax", () => {
    assert.throws(() => parseKnownBlockedRules("w*x.example.com:443"), /Invalid wildcard/);
  });

  it("throws on invalid regex syntax", () => {
    assert.throws(() => parseKnownBlockedRules("~^(unclosed"), /Invalid regex/);
  });

  it("accepts a mix of wildcard and ~regex rules", () => {
    assert.deepEqual(
      parseKnownBlockedRules("*.example.com:443 ~^api\\.example\\.com:443$"),
      ["*.example.com:443", "~^api\\.example\\.com:443$"],
    );
  });
});

describe("annotateKnownBlocked", () => {
  const row = (overrides = {}) => ({
    host: "evil.example.com",
    port: "443",
    ruleType: "HTTPS",
    reason: "not in allowlist",
    count: 3,
    ...overrides,
  });

  it("marks all rows as not expected when no rules are given", () => {
    const result = annotateKnownBlocked([row()], []);
    assert.equal(result[0].expected, false);
  });

  it("marks a row as expected on an exact host:port match", () => {
    const result = annotateKnownBlocked([row()], ["evil.example.com:443"]);
    assert.equal(result[0].expected, true);
  });

  it("marks a row as expected on a wildcard match", () => {
    const result = annotateKnownBlocked([row()], ["*.example.com:443"]);
    assert.equal(result[0].expected, true);
  });

  it("marks a row as expected on a ~regex match", () => {
    const result = annotateKnownBlocked([row()], ["~^evil\\.example\\.com:443$"]);
    assert.equal(result[0].expected, true);
  });

  it("does not match when the port differs", () => {
    const result = annotateKnownBlocked([row({ port: "80" })], ["evil.example.com:443"]);
    assert.equal(result[0].expected, false);
  });

  it("preserves the original row fields", () => {
    const result = annotateKnownBlocked([row()], []);
    assert.equal(result[0].host, "evil.example.com");
    assert.equal(result[0].port, "443");
    assert.equal(result[0].ruleType, "HTTPS");
    assert.equal(result[0].reason, "not in allowlist");
    assert.equal(result[0].count, 3);
  });

  it("annotates each row independently across a mixed list", () => {
    const result = annotateKnownBlocked(
      [row({ host: "known.example.com" }), row({ host: "unknown.example.com" })],
      ["known.example.com:443"],
    );
    assert.equal(result[0].expected, true);
    assert.equal(result[1].expected, false);
  });
});

describe("determineBlockedOutcome", () => {
  it("returns none when there are no blocked connections", () => {
    assert.deepEqual(
      determineBlockedOutcome({ isAudit: false, failOnBlocked: true, blockedCount: 0, blockedRows: [] }),
      { level: "none", shouldFail: false },
    );
  });

  it("always returns notice in audit mode, even with unmatched rows", () => {
    assert.deepEqual(
      determineBlockedOutcome({
        isAudit: true, failOnBlocked: true, blockedCount: 2,
        blockedRows: [{ expected: false }],
      }),
      { level: "notice", shouldFail: false },
    );
  });

  it("returns notice (not error) when every blocked row matched known_blocked_rules", () => {
    assert.deepEqual(
      determineBlockedOutcome({
        isAudit: false, failOnBlocked: true, blockedCount: 3,
        blockedRows: [{ expected: true }, { expected: true }],
      }),
      { level: "notice", shouldFail: false },
    );
  });

  it("returns error when at least one blocked row is unexpected", () => {
    assert.deepEqual(
      determineBlockedOutcome({
        isAudit: false, failOnBlocked: true, blockedCount: 3,
        blockedRows: [{ expected: true }, { expected: false }],
      }),
      { level: "error", shouldFail: true },
    );
  });

  it("returns notice when failOnBlocked is false, even with unexpected rows", () => {
    assert.deepEqual(
      determineBlockedOutcome({
        isAudit: false, failOnBlocked: false, blockedCount: 2,
        blockedRows: [{ expected: false }],
      }),
      { level: "notice", shouldFail: false },
    );
  });

  it("fails closed when blockedRows is empty but blockedCount is nonzero", () => {
    assert.deepEqual(
      determineBlockedOutcome({ isAudit: false, failOnBlocked: true, blockedCount: 2, blockedRows: [] }),
      { level: "error", shouldFail: true },
    );
  });
});

describe("buildBlockedMessage", () => {
  it("matches the legacy wording when known_blocked_rules is unused", () => {
    const message = buildBlockedMessage({
      blockedCount: 2, blockedRows: [{ expected: false }, { expected: false }],
      knownBlockedRulesUsed: false, engineLabel: "sandbox",
    });
    assert.equal(message, "2 blocked connection(s) detected by buildcage sandbox");
  });

  it("notes that all rows matched when every row is expected", () => {
    const message = buildBlockedMessage({
      blockedCount: 3, blockedRows: [{ expected: true }, { expected: true }],
      knownBlockedRulesUsed: true, engineLabel: "proxy",
    });
    assert.match(message, /all matched known_blocked_rules \(expected\)/);
  });

  it("reports the unmatched count when some rows are unexpected", () => {
    const message = buildBlockedMessage({
      blockedCount: 3, blockedRows: [{ expected: true }, { expected: false }],
      knownBlockedRulesUsed: true, engineLabel: "sandbox",
    });
    assert.match(message, /1 of 2 distinct blocked host\(s\) unmatched by known_blocked_rules/);
  });

  it("matches the legacy wording when known_blocked_rules is set but nothing matched", () => {
    const message = buildBlockedMessage({
      blockedCount: 2, blockedRows: [{ expected: false }, { expected: false }],
      knownBlockedRulesUsed: true, engineLabel: "sandbox",
    });
    assert.equal(message, "2 blocked connection(s) detected by buildcage sandbox");
  });
});

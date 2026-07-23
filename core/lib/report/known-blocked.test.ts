import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  annotateKnownBlocked,
  determineBlockedOutcome,
  buildBlockedMessage,
  evaluateBlockedReport,
} from "./known-blocked.ts";

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
  it("matches the legacy wording when no rows matched known_blocked_rules", () => {
    const message = buildBlockedMessage({
      blockedCount: 2, blockedRows: [{ expected: false }, { expected: false }],
      engineLabel: "sandbox", isAudit: false,
    });
    assert.equal(message, "2 blocked connection(s) detected by buildcage sandbox");
  });

  it("notes that all rows matched when every row is expected", () => {
    const message = buildBlockedMessage({
      blockedCount: 3, blockedRows: [{ expected: true }, { expected: true }],
      engineLabel: "proxy", isAudit: false,
    });
    assert.match(message, /all matched known_blocked_rules \(expected\)/);
  });

  it("reports the unmatched count when some rows are unexpected", () => {
    const message = buildBlockedMessage({
      blockedCount: 3, blockedRows: [{ expected: true }, { expected: false }],
      engineLabel: "sandbox", isAudit: false,
    });
    assert.match(message, /1 of 2 distinct blocked host\(s\) unmatched by known_blocked_rules/);
  });

  // Audit's outcome never depends on matching (see determineBlockedOutcome),
  // so the message shouldn't either.
  describe("audit mode — text must never vary with known_blocked_rules matching", () => {
    const fixedText = "5 blocked connection(s) detected by buildcage sandbox";

    it("stays fixed when every row matched", () => {
      const message = buildBlockedMessage({
        blockedCount: 5, blockedRows: [{ expected: true }, { expected: true }],
        engineLabel: "sandbox", isAudit: true,
      });
      assert.equal(message, fixedText);
    });

    it("stays fixed when some rows are unmatched", () => {
      const message = buildBlockedMessage({
        blockedCount: 5, blockedRows: [{ expected: true }, { expected: false }],
        engineLabel: "sandbox", isAudit: true,
      });
      assert.equal(message, fixedText);
    });

    it("stays fixed when no rows matched", () => {
      const message = buildBlockedMessage({
        blockedCount: 5, blockedRows: [{ expected: false }, { expected: false }],
        engineLabel: "sandbox", isAudit: true,
      });
      assert.equal(message, fixedText);
    });
  });
});

describe("evaluateBlockedReport", () => {
  it("returns level 'none' when there are no blocked connections (message is unused at that level, but still a plain string)", () => {
    const result = evaluateBlockedReport(
      { mode: "restrict", blockedCount: 0, sections: {} },
      { knownBlockedRules: [], failOnBlocked: true, engineLabel: "sandbox" },
    );
    assert.deepEqual(result.outcome, { level: "none", shouldFail: false });
    assert.equal(result.message, "0 blocked connection(s) detected by buildcage sandbox");
  });

  it("does not crash when report.sections is undefined", () => {
    const result = evaluateBlockedReport(
      { mode: "restrict", blockedCount: 0 },
      { knownBlockedRules: [], failOnBlocked: true, engineLabel: "sandbox" },
    );
    assert.deepEqual(result.blockedRows, []);
    assert.deepEqual(result.outcome, { level: "none", shouldFail: false });
  });

  it("in audit mode, the message stays fixed even when known_blocked_rules matches", () => {
    const report = {
      mode: "audit",
      blockedCount: 1,
      sections: { blocked: [{ host: "known.example.com", port: "443", ruleType: "HTTPS", reason: "-", count: 1 }] },
    };
    const result = evaluateBlockedReport(report, {
      knownBlockedRules: ["known.example.com:443"], failOnBlocked: true, engineLabel: "sandbox",
    });
    assert.equal(result.outcome.level, "notice");
    assert.equal(result.message, "1 blocked connection(s) detected by buildcage sandbox");
  });

  it("in restrict mode, returns notice (not error) when every blocked row matches", () => {
    const report = {
      mode: "restrict",
      blockedCount: 1,
      sections: { blocked: [{ host: "known.example.com", port: "443", ruleType: "HTTPS", reason: "-", count: 1 }] },
    };
    const result = evaluateBlockedReport(report, {
      knownBlockedRules: ["known.example.com:443"], failOnBlocked: true, engineLabel: "sandbox",
    });
    assert.deepEqual(result.outcome, { level: "notice", shouldFail: false });
    assert.equal(result.showExpected, true);
  });

  it("in restrict mode, returns error when a blocked row is unexpected", () => {
    const report = {
      mode: "restrict",
      blockedCount: 1,
      sections: { blocked: [{ host: "unknown.example.com", port: "443", ruleType: "HTTPS", reason: "-", count: 1 }] },
    };
    const result = evaluateBlockedReport(report, {
      knownBlockedRules: ["known.example.com:443"], failOnBlocked: true, engineLabel: "sandbox",
    });
    assert.deepEqual(result.outcome, { level: "error", shouldFail: true });
  });

  it("showExpected is false when known_blocked_rules is empty", () => {
    const report = { mode: "restrict", blockedCount: 1, sections: { blocked: [{ host: "a.com", port: "443", ruleType: "HTTPS", reason: "-", count: 1 }] } };
    const result = evaluateBlockedReport(report, { knownBlockedRules: [], failOnBlocked: true, engineLabel: "sandbox" });
    assert.equal(result.showExpected, false);
  });
});

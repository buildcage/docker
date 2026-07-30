import { describe, it, assert, reportResults } from "../test/test-shim.ts";
import {
  annotateKnownBlocked,
  determineBlockedOutcome,
  buildBlockedMessage,
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
      determineBlockedOutcome({
        isAudit: false, failOnBlocked: true, blockedCount: 0, blockedRows: [],
        logLooksPlausible: true,
      }),
      { level: "none", shouldFail: false },
    );
  });

  it("always returns notice in audit mode, even with unmatched rows", () => {
    assert.deepEqual(
      determineBlockedOutcome({
        isAudit: true, failOnBlocked: true, blockedCount: 2,
        blockedRows: [{ expected: false }], logLooksPlausible: true,
      }),
      { level: "notice", shouldFail: false },
    );
  });

  it("returns notice (not error) when every blocked row matched known_blocked_rules", () => {
    assert.deepEqual(
      determineBlockedOutcome({
        isAudit: false, failOnBlocked: true, blockedCount: 3,
        blockedRows: [{ expected: true }, { expected: true }], logLooksPlausible: true,
      }),
      { level: "notice", shouldFail: false },
    );
  });

  it("returns error when at least one blocked row is unexpected", () => {
    assert.deepEqual(
      determineBlockedOutcome({
        isAudit: false, failOnBlocked: true, blockedCount: 3,
        blockedRows: [{ expected: true }, { expected: false }], logLooksPlausible: true,
      }),
      { level: "error", shouldFail: true },
    );
  });

  it("returns notice when failOnBlocked is false, even with unexpected rows", () => {
    assert.deepEqual(
      determineBlockedOutcome({
        isAudit: false, failOnBlocked: false, blockedCount: 2,
        blockedRows: [{ expected: false }], logLooksPlausible: true,
      }),
      { level: "notice", shouldFail: false },
    );
  });

  it("fails closed when blockedRows is empty but blockedCount is nonzero", () => {
    assert.deepEqual(
      determineBlockedOutcome({
        isAudit: false, failOnBlocked: true, blockedCount: 2, blockedRows: [],
        logLooksPlausible: true,
      }),
      { level: "error", shouldFail: true },
    );
  });

  describe("logLooksPlausible: false (log has no trace of a real proxy run)", () => {
    it("fails closed when blockedCount is 0 and failOnBlocked is true", () => {
      assert.deepEqual(
        determineBlockedOutcome({
          isAudit: false, failOnBlocked: true, blockedCount: 0, blockedRows: [],
          logLooksPlausible: false,
        }),
        { level: "error", shouldFail: true },
      );
    });

    it("returns notice (not error) when blockedCount is 0 and failOnBlocked is false", () => {
      assert.deepEqual(
        determineBlockedOutcome({
          isAudit: false, failOnBlocked: false, blockedCount: 0, blockedRows: [],
          logLooksPlausible: false,
        }),
        { level: "notice", shouldFail: false },
      );
    });

    it("never fails in audit mode, even with an implausible log", () => {
      assert.deepEqual(
        determineBlockedOutcome({
          isAudit: true, failOnBlocked: true, blockedCount: 0, blockedRows: [],
          logLooksPlausible: false,
        }),
        { level: "notice", shouldFail: false },
      );
    });

    it("has no additional effect when blockedCount is already nonzero", () => {
      assert.deepEqual(
        determineBlockedOutcome({
          isAudit: false, failOnBlocked: true, blockedCount: 3,
          blockedRows: [{ expected: true }, { expected: true }], logLooksPlausible: false,
        }),
        { level: "notice", shouldFail: false },
      );
    });
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

reportResults();

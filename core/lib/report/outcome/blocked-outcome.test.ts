import { describe, it, expect, reportResults } from "#core/lib/test/test-shim.ts";
import {
  determineBlockedOutcome,
  buildBlockedMessage,
  describeBlockedOutcome,
} from "./blocked-outcome.ts";

describe("determineBlockedOutcome", () => {
  it("returns none when there are no blocked connections", () => {
    expect(
      determineBlockedOutcome({
        isAudit: false,
        failOnBlocked: true,
        blockedCount: 0,
        blockedRows: [],
        logLooksPlausible: true,
      }),
    ).toStrictEqual({ level: "none", shouldFail: false });
  });

  it("always returns notice in audit mode, even with unmatched rows", () => {
    expect(
      determineBlockedOutcome({
        isAudit: true,
        failOnBlocked: true,
        blockedCount: 2,
        blockedRows: [{ expected: false }],
        logLooksPlausible: true,
      }),
    ).toStrictEqual({ level: "notice", shouldFail: false });
  });

  it("returns notice (not error) when every blocked row matched known_blocked_rules", () => {
    expect(
      determineBlockedOutcome({
        isAudit: false,
        failOnBlocked: true,
        blockedCount: 3,
        blockedRows: [{ expected: true }, { expected: true }],
        logLooksPlausible: true,
      }),
    ).toStrictEqual({ level: "notice", shouldFail: false });
  });

  it("returns error when at least one blocked row is unexpected", () => {
    expect(
      determineBlockedOutcome({
        isAudit: false,
        failOnBlocked: true,
        blockedCount: 3,
        blockedRows: [{ expected: true }, { expected: false }],
        logLooksPlausible: true,
      }),
    ).toStrictEqual({ level: "error", shouldFail: true });
  });

  it("returns notice when failOnBlocked is false, even with unexpected rows", () => {
    expect(
      determineBlockedOutcome({
        isAudit: false,
        failOnBlocked: false,
        blockedCount: 2,
        blockedRows: [{ expected: false }],
        logLooksPlausible: true,
      }),
    ).toStrictEqual({ level: "notice", shouldFail: false });
  });

  it("fails closed when blockedRows is empty but blockedCount is nonzero", () => {
    expect(
      determineBlockedOutcome({
        isAudit: false,
        failOnBlocked: true,
        blockedCount: 2,
        blockedRows: [],
        logLooksPlausible: true,
      }),
    ).toStrictEqual({ level: "error", shouldFail: true });
  });

  describe("logLooksPlausible: false (log has no trace of a real proxy run)", () => {
    it("fails closed when blockedCount is 0 and failOnBlocked is true", () => {
      expect(
        determineBlockedOutcome({
          isAudit: false,
          failOnBlocked: true,
          blockedCount: 0,
          blockedRows: [],
          logLooksPlausible: false,
        }),
      ).toStrictEqual({ level: "error", shouldFail: true });
    });

    it("returns notice (not error) when blockedCount is 0 and failOnBlocked is false", () => {
      expect(
        determineBlockedOutcome({
          isAudit: false,
          failOnBlocked: false,
          blockedCount: 0,
          blockedRows: [],
          logLooksPlausible: false,
        }),
      ).toStrictEqual({ level: "notice", shouldFail: false });
    });

    it("never fails in audit mode, even with an implausible log", () => {
      expect(
        determineBlockedOutcome({
          isAudit: true,
          failOnBlocked: true,
          blockedCount: 0,
          blockedRows: [],
          logLooksPlausible: false,
        }),
      ).toStrictEqual({ level: "notice", shouldFail: false });
    });

    it("has no additional effect when blockedCount is already nonzero", () => {
      expect(
        determineBlockedOutcome({
          isAudit: false,
          failOnBlocked: true,
          blockedCount: 3,
          blockedRows: [{ expected: true }, { expected: true }],
          logLooksPlausible: false,
        }),
      ).toStrictEqual({ level: "notice", shouldFail: false });
    });
  });
});

describe("buildBlockedMessage", () => {
  it("matches the legacy wording when no rows matched known_blocked_rules", () => {
    const message = buildBlockedMessage({
      blockedCount: 2,
      blockedRows: [{ expected: false }, { expected: false }],
      engineLabel: "sandbox",
      isAudit: false,
    });
    expect(message).toBe("2 blocked connection(s) detected by buildcage sandbox");
  });

  it("notes that all rows matched when every row is expected", () => {
    const message = buildBlockedMessage({
      blockedCount: 3,
      blockedRows: [{ expected: true }, { expected: true }],
      engineLabel: "proxy",
      isAudit: false,
    });
    expect(message).toMatch(/all matched known_blocked_rules \(expected\)/);
  });

  it("reports the unmatched count when some rows are unexpected", () => {
    const message = buildBlockedMessage({
      blockedCount: 3,
      blockedRows: [{ expected: true }, { expected: false }],
      engineLabel: "sandbox",
      isAudit: false,
    });
    expect(message).toMatch(/1 of 2 distinct blocked host\(s\) unmatched by known_blocked_rules/);
  });

  // Audit's outcome never depends on matching (see determineBlockedOutcome),
  // so the message shouldn't either.
  describe("audit mode — text must never vary with known_blocked_rules matching", () => {
    const fixedText = "5 blocked connection(s) detected by buildcage sandbox";

    it("stays fixed when every row matched", () => {
      const message = buildBlockedMessage({
        blockedCount: 5,
        blockedRows: [{ expected: true }, { expected: true }],
        engineLabel: "sandbox",
        isAudit: true,
      });
      expect(message).toBe(fixedText);
    });

    it("stays fixed when some rows are unmatched", () => {
      const message = buildBlockedMessage({
        blockedCount: 5,
        blockedRows: [{ expected: true }, { expected: false }],
        engineLabel: "sandbox",
        isAudit: true,
      });
      expect(message).toBe(fixedText);
    });

    it("stays fixed when no rows matched", () => {
      const message = buildBlockedMessage({
        blockedCount: 5,
        blockedRows: [{ expected: false }, { expected: false }],
        engineLabel: "sandbox",
        isAudit: true,
      });
      expect(message).toBe(fixedText);
    });
  });
});

describe("describeBlockedOutcome", () => {
  it("combines determineBlockedOutcome's decision with buildBlockedMessage's text", () => {
    const result = describeBlockedOutcome({
      isAudit: false,
      failOnBlocked: true,
      blockedCount: 1,
      blockedRows: [{ expected: false }],
      logLooksPlausible: true,
      engineLabel: "proxy",
    });
    expect(result).toStrictEqual({
      level: "error",
      shouldFail: true,
      message: "1 blocked connection(s) detected by buildcage proxy",
    });
  });

  it("passes engineLabel through to the message", () => {
    const result = describeBlockedOutcome({
      isAudit: false,
      failOnBlocked: false,
      blockedCount: 0,
      blockedRows: [],
      logLooksPlausible: true,
      engineLabel: "sandbox",
    });
    expect(result.level).toBe("none");
  });
});

reportResults();

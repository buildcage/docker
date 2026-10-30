import { describe, it, expect } from "vitest";

import { UNINTERRUPTED } from "#core/lib/test/report-data.node.ts";

import {
  determineBlockedOutcome,
  buildBlockedMessage,
  describeBlockedOutcome,
  describeInterruptions,
  type BuildBlockedMessageOptions,
  type DescribeBlockedOutcomeOptions,
  type DetermineBlockedOutcomeOptions,
} from "./blocked-outcome.ts";

/** Restrict mode, set to fail, with one blocked row no rule matched. */
const decide = (overrides: Partial<DetermineBlockedOutcomeOptions> = {}) =>
  determineBlockedOutcome({
    isAudit: false,
    failOnBlocked: true,
    blockedCount: 2,
    blockedRows: [{ expected: false }],
    logLooksPlausible: true,
    proxyAnswered: true,
    ...overrides,
  });

const message = (overrides: Partial<BuildBlockedMessageOptions> = {}) =>
  buildBlockedMessage({
    blockedCount: 2,
    blockedRows: [{ expected: false }, { expected: false }],
    engineLabel: "sandbox",
    isAudit: false,
    ...overrides,
  });

const described = (overrides: Partial<DescribeBlockedOutcomeOptions> = {}) =>
  describeBlockedOutcome({
    isAudit: false,
    failOnBlocked: true,
    blockedCount: 1,
    blockedRows: [{ expected: false }],
    logLooksPlausible: true,
    ...UNINTERRUPTED,
    engineLabel: "proxy",
    ...overrides,
  });

describe("determineBlockedOutcome", () => {
  it("returns none when there are no blocked connections", () => {
    expect(decide({ blockedCount: 0 })).toStrictEqual({ level: "none", shouldFail: false });
  });

  it("always returns notice in audit mode, even with unmatched rows", () => {
    expect(decide({ isAudit: true })).toStrictEqual({ level: "notice", shouldFail: false });
  });

  it("returns notice (not error) when every blocked row matched known-blocked-rules", () => {
    expect(
      decide({ blockedCount: 3, blockedRows: [{ expected: true }, { expected: true }] }),
    ).toStrictEqual({ level: "notice", shouldFail: false });
  });

  it("returns error when at least one blocked row is unexpected", () => {
    expect(
      decide({ blockedCount: 3, blockedRows: [{ expected: true }, { expected: false }] }),
    ).toStrictEqual({ level: "error", shouldFail: true });
  });

  it("returns notice when failOnBlocked is false, even with unexpected rows", () => {
    expect(decide({ failOnBlocked: false })).toStrictEqual({
      level: "notice",
      shouldFail: false,
    });
  });

  it("fails closed when blockedRows is empty but blockedCount is nonzero", () => {
    expect(decide({ blockedRows: [] })).toStrictEqual({ level: "error", shouldFail: true });
  });

  describe("logLooksPlausible: false (the log is not a complete record of the run)", () => {
    // The decision is made before the count and the rows are read, so what
    // survived cannot change it: the rows that are gone are the ones that
    // would have failed the step.
    const surviving = [
      { blockedCount: 0, blockedRows: [] },
      { blockedCount: 3, blockedRows: [{ expected: true }, { expected: true }] },
    ];

    it("fails closed whatever survived, when failOnBlocked is true", () => {
      for (const rows of surviving) {
        expect(decide({ ...rows, logLooksPlausible: false })).toStrictEqual({
          level: "error",
          shouldFail: true,
        });
      }
    });

    it("returns notice whatever survived, when failOnBlocked is false", () => {
      for (const rows of surviving) {
        expect(decide({ ...rows, logLooksPlausible: false, failOnBlocked: false })).toStrictEqual({
          level: "notice",
          shouldFail: false,
        });
      }
    });

    it("never fails in audit mode, whatever survived", () => {
      for (const rows of surviving) {
        expect(decide({ ...rows, logLooksPlausible: false, isAudit: true })).toStrictEqual({
          level: "notice",
          shouldFail: false,
        });
      }
    });
  });

  it("fails whatever the mode or failOnBlocked when the proxy did not answer", () => {
    for (const isAudit of [false, true]) {
      for (const failOnBlocked of [false, true]) {
        expect(
          decide({
            isAudit,
            failOnBlocked,
            blockedCount: 0,
            blockedRows: [],
            logLooksPlausible: false,
            proxyAnswered: false,
          }),
        ).toStrictEqual({ level: "error", shouldFail: true });
      }
    }
  });
});

describe("describeInterruptions", () => {
  it("names nothing for a run nothing interrupted", () => {
    expect(describeInterruptions(UNINTERRUPTED)).toStrictEqual([]);
  });

  it("names a proxy that did not answer", () => {
    expect(describeInterruptions({ ...UNINTERRUPTED, proxyAnswered: false })).toStrictEqual([
      "The proxy did not answer the report, so it stopped or hung during the run. Requests made while it was down failed rather than going around it, and the step fails for this whatever the mode or fail-on-blocked.",
    ]);
  });

  it("counts each service's restarts and says what a restart loses", () => {
    expect(
      describeInterruptions({ proxyAnswered: true, restarts: { proxy: 2, resolver: 1 } }),
    ).toStrictEqual([
      "The proxy restarted 2 time(s) during the run.",
      "The DNS resolver restarted 1 time(s) during the run.",
      "A restart loses the line of whatever was still in progress when the service stopped.",
    ]);
  });
});

describe("buildBlockedMessage", () => {
  it("stays the base text when no rows matched known-blocked-rules", () => {
    expect(message()).toBe("2 blocked connection(s) and lookup(s) detected by buildcage sandbox");
  });

  it("notes that all rows matched when every row is expected", () => {
    expect(
      message({
        blockedCount: 3,
        blockedRows: [{ expected: true }, { expected: true }],
        engineLabel: "proxy",
      }),
    ).toMatch(/all matched known-blocked-rules \(expected\)/);
  });

  it("reports the unmatched count when some rows are unexpected", () => {
    expect(
      message({ blockedCount: 3, blockedRows: [{ expected: true }, { expected: false }] }),
    ).toMatch(/1 of 2 distinct blocked host\(s\) unmatched by known-blocked-rules/);
  });

  // Audit's outcome never depends on matching (see determineBlockedOutcome),
  // so the message shouldn't either.
  it("stays fixed in audit mode, whatever matched", () => {
    const rowSets = [
      [{ expected: true }, { expected: true }],
      [{ expected: true }, { expected: false }],
      [{ expected: false }, { expected: false }],
    ];
    for (const blockedRows of rowSets) {
      expect(message({ blockedCount: 5, blockedRows, isAudit: true })).toBe(
        "5 blocked connection(s) and lookup(s) detected by buildcage sandbox",
      );
    }
  });
});

describe("describeBlockedOutcome", () => {
  it("combines determineBlockedOutcome's decision with buildBlockedMessage's text", () => {
    expect(described()).toStrictEqual({
      level: "error",
      shouldFail: true,
      message: "1 blocked connection(s) and lookup(s) detected by buildcage proxy",
    });
  });

  it("passes engineLabel through to the message", () => {
    const result = described({
      failOnBlocked: false,
      blockedCount: 0,
      blockedRows: [],
      engineLabel: "sandbox",
    });
    expect(result.level).toBe("none");
    expect(result.message).toContain("buildcage sandbox");
  });

  it("leads with the incomplete log but keeps the count that did survive", () => {
    expect(
      described({
        blockedCount: 3,
        blockedRows: [{ expected: true }],
        logLooksPlausible: false,
      }),
    ).toStrictEqual({
      level: "error",
      shouldFail: true,
      message:
        "buildcage proxy logs are incomplete, so this report is not a full record of what ran (3 blocked connection(s) and lookup(s) still recorded). Either the logs don't begin where a real run does, one carries a line the report cannot read, or the proxy dropped lines it could not write (or could not say whether it had). A missing beginning was either removed or rotated out by traffic heavy enough to fill the 100 MB of log kept, which takes a few hundred thousand ordinary requests or a few thousand made as long as a request can be: the report's own tables still count what survived, per host.",
    });
  });

  it("appends to audit's fixed-format notice instead of replacing it", () => {
    const result = described({
      isAudit: true,
      blockedCount: 2,
      blockedRows: [{ expected: true }],
      logLooksPlausible: false,
    });
    expect(result.level).toBe("notice");
    expect(result.shouldFail).toBe(false);
    expect(
      result.message.startsWith(
        "2 blocked connection(s) and lookup(s) detected by buildcage proxy",
      ),
    ).toBe(true);
    expect(result.message).toContain("the logs are incomplete");
  });

  it("names a restart after audit's notice", () => {
    expect(
      described({
        isAudit: true,
        blockedCount: 2,
        blockedRows: [{ expected: false }],
        logLooksPlausible: false,
        restarts: { proxy: 1, resolver: 0 },
      }),
    ).toStrictEqual({
      level: "notice",
      shouldFail: false,
      message:
        "2 blocked connection(s) and lookup(s) detected by buildcage proxy, but the logs are incomplete and this is not a full record. The proxy restarted 1 time(s) during the run. A restart loses the line of whatever was still in progress when the service stopped.",
    });
  });

  it("fails audit for a proxy that did not answer, naming that before the other causes", () => {
    expect(
      described({
        isAudit: true,
        blockedCount: 0,
        blockedRows: [],
        logLooksPlausible: false,
        proxyAnswered: false,
      }),
    ).toStrictEqual({
      level: "error",
      shouldFail: true,
      message:
        "buildcage proxy logs are incomplete, so this report is not a full record of what ran. The proxy did not answer the report, so it stopped or hung during the run. Requests made while it was down failed rather than going around it, and the step fails for this whatever the mode or fail-on-blocked. Other causes may apply too: the logs don't begin where a real run does, one carries a line the report cannot read, or the proxy dropped lines it could not write (or could not say whether it had). A missing beginning was either removed or rotated out by traffic heavy enough to fill the 100 MB of log kept, which takes a few hundred thousand ordinary requests or a few thousand made as long as a request can be: the report's own tables still count what survived, per host.",
    });
  });

  it("names no count for an incomplete log that recorded none", () => {
    expect(
      described({
        blockedCount: 0,
        blockedRows: [],
        logLooksPlausible: false,
        engineLabel: "sandbox",
      }).message,
    ).toBe(
      "buildcage sandbox logs are incomplete, so this report is not a full record of what ran. Either the logs don't begin where a real run does, one carries a line the report cannot read, or the proxy dropped lines it could not write (or could not say whether it had). A missing beginning was either removed or rotated out by traffic heavy enough to fill the 100 MB of log kept, which takes a few hundred thousand ordinary requests or a few thousand made as long as a request can be: the report's own tables still count what survived, per host.",
    );
  });
});

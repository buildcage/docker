import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { emitBlockedOutcome } from "./emit-blocked-outcome.ts";
import { annotateKnownBlocked } from "./known-blocked.ts";
import type { ReportDataCommon, GenReportParameters } from "./report-data.ts";

let prevExitCode: number | string | null | undefined;

beforeEach(() => {
  prevExitCode = process.exitCode;
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = prevExitCode;
});

function parameters(overrides: Partial<GenReportParameters> = {}): GenReportParameters {
  return {
    mode: "restrict",
    allowedHttpsRules: [],
    allowedHttpRules: [],
    allowedIpRules: [],
    knownBlockedRules: [],
    ...overrides,
  };
}

function report(overrides: Partial<ReportDataCommon> = {}): ReportDataCommon {
  return {
    parameters: parameters(),
    passed: [],
    blocked: [],
    blockedCount: 0,
    logLooksPlausible: true,
    ...overrides,
  };
}

describe("emitBlockedOutcome", () => {
  it("leaves exitCode untouched when there are no blocked connections", () => {
    emitBlockedOutcome(report(), { failOnBlocked: true, summaryFile: undefined });
    assert.equal(process.exitCode, undefined);
  });

  it("sets exitCode=1 when an unexpected blocked connection is found and failOnBlocked is true", () => {
    const r = report({
      blockedCount: 1,
      blocked: annotateKnownBlocked(
        [{ host: "bad.example.com", port: "443", ruleType: "HTTPS", reason: "not in allowlist", count: 1 }],
        [],
      ),
    });
    emitBlockedOutcome(r, { failOnBlocked: true, summaryFile: undefined });
    assert.equal(process.exitCode, 1);
  });

  it("leaves exitCode untouched when failOnBlocked is false, even with blocked connections", () => {
    const r = report({
      blockedCount: 1,
      blocked: annotateKnownBlocked(
        [{ host: "bad.example.com", port: "443", ruleType: "HTTPS", reason: "not in allowlist", count: 1 }],
        [],
      ),
    });
    emitBlockedOutcome(r, { failOnBlocked: false, summaryFile: undefined });
    assert.equal(process.exitCode, undefined);
  });

  it("sets exitCode=1 when blockedCount is 0 but the log looks implausible (tampering signal)", () => {
    const r = report({ blockedCount: 0, logLooksPlausible: false });
    emitBlockedOutcome(r, { failOnBlocked: true, summaryFile: undefined });
    assert.equal(process.exitCode, 1);
  });

  it("leaves exitCode untouched in audit mode even when failOnBlocked is true", () => {
    const r = report({
      parameters: parameters({ mode: "audit" }),
      blockedCount: 1,
      blocked: annotateKnownBlocked(
        [{ host: "bad.example.com", port: "443", ruleType: "HTTPS", reason: "not in allowlist", count: 1 }],
        [],
      ),
    });
    emitBlockedOutcome(r, { failOnBlocked: true, summaryFile: undefined });
    assert.equal(process.exitCode, undefined);
  });

  it("leaves exitCode untouched when every blocked connection matches known_blocked_rules", () => {
    const knownBlockedRules = ["known-bad.example.com:443"];
    const r = report({
      parameters: parameters({ knownBlockedRules }),
      blockedCount: 1,
      blocked: annotateKnownBlocked(
        [{ host: "known-bad.example.com", port: "443", ruleType: "HTTPS", reason: "not in allowlist", count: 1 }],
        knownBlockedRules,
      ),
    });
    emitBlockedOutcome(r, { failOnBlocked: true, summaryFile: undefined });
    assert.equal(process.exitCode, undefined);
  });

  it("emits ::notice:: (not ::error::) when console output is enabled and outcome level is notice", (t) => {
    const log = t.mock.method(console, "log", () => {});
    const r = report({
      parameters: parameters({ mode: "audit" }),
      blockedCount: 1,
      blocked: annotateKnownBlocked(
        [{ host: "bad.example.com", port: "443", ruleType: "HTTPS", reason: "not in allowlist", count: 1 }],
        [],
      ),
    });
    emitBlockedOutcome(r, { failOnBlocked: true, summaryFile: "/tmp/summary.md" });
    const notices = log.mock.calls.map((c) => c.arguments[0] as string).filter((s) => s.startsWith("::notice::"));
    const errors = log.mock.calls.map((c) => c.arguments[0] as string).filter((s) => s.startsWith("::error::"));
    assert.equal(notices.length, 1);
    assert.equal(errors.length, 0);
  });

  it("emits ::error:: when console output is enabled and outcome level is error", (t) => {
    const log = t.mock.method(console, "log", () => {});
    const r = report({
      blockedCount: 1,
      blocked: annotateKnownBlocked(
        [{ host: "bad.example.com", port: "443", ruleType: "HTTPS", reason: "not in allowlist", count: 1 }],
        [],
      ),
    });
    emitBlockedOutcome(r, { failOnBlocked: true, summaryFile: "/tmp/summary.md" });
    const errors = log.mock.calls.map((c) => c.arguments[0] as string).filter((s) => s.startsWith("::error::"));
    assert.equal(errors.length, 1);
  });

  it("suppresses annotation output when summaryFile is undefined (not running as the real action)", (t) => {
    const log = t.mock.method(console, "log", () => {});
    const r = report({
      blockedCount: 1,
      blocked: annotateKnownBlocked(
        [{ host: "bad.example.com", port: "443", ruleType: "HTTPS", reason: "not in allowlist", count: 1 }],
        [],
      ),
    });
    emitBlockedOutcome(r, { failOnBlocked: true, summaryFile: undefined });
    const annotations = log.mock.calls
      .map((c) => c.arguments[0] as string)
      .filter((s) => s.startsWith("::notice::") || s.startsWith("::error::"));
    assert.equal(annotations.length, 0);
  });
});

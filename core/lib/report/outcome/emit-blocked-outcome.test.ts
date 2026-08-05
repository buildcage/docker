import { describe, it, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";

import { emitBlockedOutcome } from "./emit-blocked-outcome.ts";
import { annotateKnownBlocked } from "../build/annotate-known-blocked.ts";
import type { ReportDataCommon, GenReportParameters } from "../types.ts";

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

// The decision matrix itself is tested elsewhere; these only verify the
// exit-code/annotation wiring.
describe("emitBlockedOutcome", () => {
  it("leaves exitCode untouched when there are no blocked connections", () => {
    emitBlockedOutcome(report(), { failOnBlocked: true, summaryFile: undefined });
    assert.equal(process.exitCode, undefined);
  });

  it("sets exitCode=1 when an unexpected blocked connection is found and failOnBlocked is true", () => {
    const r = report({
      blockedCount: 1,
      blocked: annotateKnownBlocked(
        [
          {
            host: "bad.example.com",
            port: "443",
            ruleType: "HTTPS",
            reason: "not in allowlist",
            count: 1,
          },
        ],
        [],
      ),
    });
    emitBlockedOutcome(r, { failOnBlocked: true, summaryFile: undefined });
    assert.equal(process.exitCode, 1);
  });

  it("emits ::notice:: (not ::error::) when console output is enabled and outcome level is notice", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const r = report({
      parameters: parameters({ mode: "audit" }),
      blockedCount: 1,
      blocked: annotateKnownBlocked(
        [
          {
            host: "bad.example.com",
            port: "443",
            ruleType: "HTTPS",
            reason: "not in allowlist",
            count: 1,
          },
        ],
        [],
      ),
    });
    emitBlockedOutcome(r, { failOnBlocked: true, summaryFile: "/tmp/summary.md" });
    const notices = log.mock.calls
      .map((c) => c[0] as string)
      .filter((s) => s.startsWith("::notice::"));
    const errors = log.mock.calls
      .map((c) => c[0] as string)
      .filter((s) => s.startsWith("::error::"));
    assert.equal(notices.length, 1);
    assert.equal(errors.length, 0);
  });

  it("emits ::error:: when console output is enabled and outcome level is error", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const r = report({
      blockedCount: 1,
      blocked: annotateKnownBlocked(
        [
          {
            host: "bad.example.com",
            port: "443",
            ruleType: "HTTPS",
            reason: "not in allowlist",
            count: 1,
          },
        ],
        [],
      ),
    });
    emitBlockedOutcome(r, { failOnBlocked: true, summaryFile: "/tmp/summary.md" });
    const errors = log.mock.calls
      .map((c) => c[0] as string)
      .filter((s) => s.startsWith("::error::"));
    assert.equal(errors.length, 1);
  });

  it("suppresses annotation output when summaryFile is undefined (not running as the real action)", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const r = report({
      blockedCount: 1,
      blocked: annotateKnownBlocked(
        [
          {
            host: "bad.example.com",
            port: "443",
            ruleType: "HTTPS",
            reason: "not in allowlist",
            count: 1,
          },
        ],
        [],
      ),
    });
    emitBlockedOutcome(r, { failOnBlocked: true, summaryFile: undefined });
    const annotations = log.mock.calls
      .map((c) => c[0] as string)
      .filter((s) => s.startsWith("::notice::") || s.startsWith("::error::"));
    assert.equal(annotations.length, 0);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { annotateKnownBlocked } from "#core/lib/report/build/aggregate.ts";
import type { UniversalReportData } from "#core/lib/report/types.ts";
import { reportParams } from "#core/lib/test/report-data.node.ts";

import { emitReportOutcomes } from "./emit.ts";

let prevExitCode: number | string | null | undefined;

beforeEach(() => {
  prevExitCode = process.exitCode;
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = prevExitCode;
});

function report(overrides: Partial<UniversalReportData> = {}): UniversalReportData {
  return {
    engine: "universal",
    parameters: reportParams(),
    passed: [],
    blocked: [],
    failed: [],
    blockedCount: 0,
    logLooksPlausible: true,
    timeline: [],
    startedAt: undefined,
    ...overrides,
  };
}

/** A report carrying the one blocked connection no rule accounts for. */
function blockedReport(overrides: Partial<UniversalReportData> = {}): UniversalReportData {
  return report({
    blockedCount: 1,
    blocked: annotateKnownBlocked(
      [
        {
          time: 1,
          action: "block",
          protocol: "https",
          host: "bad.example.com",
          port: 443,
          reason: "not in allowlist",
        },
      ],
      [],
    ),
    ...overrides,
  });
}

/** The annotations this call wrote to the job log, by level. */
function captureAnnotations(run: () => void): { notices: string[]; errors: string[] } {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  run();
  const lines = log.mock.calls.map((c) => c[0] as string);
  return {
    notices: lines.filter((s) => s.startsWith("::notice::")),
    errors: lines.filter((s) => s.startsWith("::error::")),
  };
}

// The decision matrix is blocked-outcome.ts's (tested there), and emitting the
// decision is annotate.ts's (tested there). What is left here is the mapping
// from a report to that decision, and the gate on summaryFile.
describe("emitReportOutcomes", () => {
  it("leaves exitCode untouched and says nothing when there are no blocked connections", () => {
    const { notices, errors } = captureAnnotations(() =>
      emitReportOutcomes(report(), { failOnBlocked: true, summaryFile: "/tmp/summary.md" }),
    );
    expect(process.exitCode).toBe(undefined);
    expect([...notices, ...errors]).toStrictEqual([]);
  });

  it("fails the step with an ::error:: for a blocked connection in restrict mode", () => {
    const { notices, errors } = captureAnnotations(() =>
      emitReportOutcomes(blockedReport(), { failOnBlocked: true, summaryFile: "/tmp/summary.md" }),
    );
    expect(process.exitCode).toBe(1);
    expect(errors.length).toBe(1);
    expect(notices.length).toBe(0);
  });

  it("reads the report's own mode, so audit gets a ::notice:: and no failure", () => {
    const { notices, errors } = captureAnnotations(() =>
      emitReportOutcomes(blockedReport({ parameters: reportParams({ mode: "audit" }) }), {
        failOnBlocked: true,
        summaryFile: "/tmp/summary.md",
      }),
    );
    expect(process.exitCode).toBe(undefined);
    expect(notices.length).toBe(1);
    expect(errors.length).toBe(0);
  });

  it("still fails the step with no summaryFile, which only suppresses the annotation", () => {
    const { notices, errors } = captureAnnotations(() =>
      emitReportOutcomes(blockedReport(), { failOnBlocked: true, summaryFile: undefined }),
    );
    expect(process.exitCode).toBe(1);
    expect([...notices, ...errors]).toStrictEqual([]);
  });
});

// @ts-nocheck
/**
 * Unit tests for run/lib/report.js — specifically writeReport's
 * exit-code semantics (see main.js's own `if (exitCode !== 0)` for the
 * other half: the isolated command's own exit code always fails the step
 * regardless of blocked connections, and this file's `process.exitCode = 1`
 * is only ever additive on top of that, never resetting it back to success).
 *
 * Run with: node --test run/src/lib/report.test.js
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { writeReport, buildReportMarkdown } from "./report.ts";
import { annotateKnownBlocked } from "../../../core/lib/report/known-blocked.ts";
import { withScratchDir } from "./isolated-exec.ts";

// writeReport reads GITHUB_STEP_SUMMARY/BUILDCAGE_RUN_DEBUG_SUMMARY_FILE
// from process.env and mutates process.exitCode directly (mirroring what
// main.js itself does) -- both are saved/restored per test so a test here
// can never leak into another test in this file, another test file, or
// (critically) into `node --test`'s own final exit status.
let prevEnv;
let prevExitCode;

beforeEach(() => {
  prevEnv = { ...process.env };
  prevExitCode = process.exitCode;
  process.exitCode = undefined;
});

afterEach(() => {
  process.env = prevEnv;
  process.exitCode = prevExitCode;
});

function writeReportWithSummary(report, opts) {
  return withScratchDir((dir) => {
    const summaryPath = join(dir, "summary.md");
    writeFileSync(summaryPath, "");
    process.env.GITHUB_STEP_SUMMARY = summaryPath;
    delete process.env.BUILDCAGE_RUN_DEBUG_SUMMARY_FILE;
    writeReport(report, opts);
    return process.exitCode;
  });
}

describe("writeReport", () => {
  it("leaves exitCode untouched when there are no blocked connections", () => {
    const report = { mode: "restrict", blockedCount: 0, sections: {} };
    assert.equal(writeReportWithSummary(report, { failOnBlocked: true }), undefined);
  });

  it("sets exitCode=1 when blocked connections are detected and failOnBlocked is true", () => {
    const report = { mode: "restrict", blockedCount: 2, sections: {} };
    assert.equal(writeReportWithSummary(report, { failOnBlocked: true }), 1);
  });

  it("leaves exitCode untouched when failOnBlocked is false, even with blocked connections", () => {
    const report = { mode: "restrict", blockedCount: 2, sections: {} };
    assert.equal(writeReportWithSummary(report, { failOnBlocked: false }), undefined);
  });

  it("leaves exitCode untouched in audit mode even when failOnBlocked is true", () => {
    const report = { mode: "audit", blockedCount: 2, sections: {} };
    assert.equal(writeReportWithSummary(report, { failOnBlocked: true }), undefined);
  });

  it("leaves exitCode untouched when every blocked connection matches known_blocked_rules", () => {
    const report = {
      mode: "restrict",
      blockedCount: 3,
      sections: {
        blocked: [{ host: "known-bad.example.com", port: "443", ruleType: "HTTPS", reason: "not in allowlist", count: 3 }],
      },
    };
    assert.equal(
      writeReportWithSummary(report, { failOnBlocked: true, knownBlockedRules: ["known-bad.example.com:443"] }),
      undefined,
    );
  });

  it("sets exitCode=1 when some blocked rows don't match known_blocked_rules", () => {
    const report = {
      mode: "restrict",
      blockedCount: 4,
      sections: {
        blocked: [
          { host: "known-bad.example.com", port: "443", ruleType: "HTTPS", reason: "not in allowlist", count: 3 },
          { host: "unexpected.example.com", port: "443", ruleType: "HTTPS", reason: "not in allowlist", count: 1 },
        ],
      },
    };
    assert.equal(
      writeReportWithSummary(report, { failOnBlocked: true, knownBlockedRules: ["known-bad.example.com:443"] }),
      1,
    );
  });

  it("leaves exitCode untouched in audit mode even with known_blocked_rules set", () => {
    const report = {
      mode: "audit",
      blockedCount: 1,
      sections: { blocked: [{ host: "known-bad.example.com", port: "443", ruleType: "HTTPS", reason: "-", count: 1 }] },
    };
    assert.equal(
      writeReportWithSummary(report, { failOnBlocked: true, knownBlockedRules: ["known-bad.example.com:443"] }),
      undefined,
    );
  });

  // Audit's outcome never depends on known_blocked_rules matching, so the
  // notice text shouldn't either.
  it("audit-mode notice text stays fixed even when known_blocked_rules matches every blocked connection", (t) => {
    const log = t.mock.method(console, "log", () => {});
    const report = {
      mode: "audit",
      blockedCount: 2,
      sections: { blocked: [{ host: "known-bad.example.com", port: "443", ruleType: "HTTPS", reason: "-", count: 2 }] },
    };
    writeReportWithSummary(report, { failOnBlocked: true, knownBlockedRules: ["known-bad.example.com:443"] });
    assert.equal(log.mock.calls.length, 1);
    assert.equal(log.mock.calls[0].arguments[0], "::notice::2 blocked connection(s) detected by buildcage sandbox");
  });
});

describe("buildReportMarkdown", () => {
  it("includes a restrict-mode example (as a `run` step) in audit mode with audited hosts", () => {
    const report = {
      mode: "audit",
      blockedCount: 0,
      sections: {
        audited: [{ host: "registry.npmjs.org", port: "443", ruleType: "HTTPS", count: 3 }],
      },
    };
    const markdown = buildReportMarkdown(report, {
      actionRepo: "dash14/buildcage",
      actionRef: "v2",
      runCommand: "npm install",
    });
    assert.match(markdown, /Switch to restrict mode/);
    assert.match(markdown, /uses: dash14\/buildcage\/run@v2/);
    assert.match(markdown, /run: \|\n\s+npm install/);
    assert.match(markdown, /allowed_https_rules: >-\n\s+registry\.npmjs\.org:443/);
  });

  it("omits the restrict-mode example in restrict mode", () => {
    const report = {
      mode: "restrict",
      blockedCount: 0,
      sections: { allowed: [{ host: "registry.npmjs.org", port: "443", ruleType: "HTTPS", count: 3 }] },
    };
    const markdown = buildReportMarkdown(report, { actionRepo: "dash14/buildcage", actionRef: "v2" });
    assert.doesNotMatch(markdown, /Switch to restrict mode/);
  });

  it("omits the restrict-mode example in audit mode with no audited hosts", () => {
    const report = { mode: "audit", blockedCount: 0, sections: {} };
    const markdown = buildReportMarkdown(report, { actionRepo: "dash14/buildcage", actionRef: "v2" });
    assert.doesNotMatch(markdown, /Switch to restrict mode/);
  });

  it("uses a level-2 heading matching the report action's wording", () => {
    const report = { mode: "restrict", blockedCount: 0, sections: {} };
    const markdown = buildReportMarkdown(report, { actionRepo: "dash14/buildcage", actionRef: "v2" });
    assert.match(markdown, /^## Outbound Traffic Report \(restrict mode\)\n/);
  });

  it("appends stepLabel to the heading to tell steps apart", () => {
    const report = { mode: "restrict", blockedCount: 0, sections: {} };
    const markdown = buildReportMarkdown(report, {
      actionRepo: "dash14/buildcage",
      actionRef: "v2",
      stepLabel: "npm install",
    });
    assert.match(markdown, /^## Outbound Traffic Report — npm install \(restrict mode\)\n/);
  });

  it("appends stepLabel to the heading even when there are no proxy logs", () => {
    const report = { mode: null };
    const markdown = buildReportMarkdown(report, { stepLabel: "npm install" });
    assert.match(markdown, /^## Outbound Traffic Report — npm install\n\nNo proxy logs found\.\n$/);
  });

  it("adds an Expected column marking known_blocked_rules matches when set", () => {
    const blockedRows = annotateKnownBlocked(
      [
        { host: "known-bad.example.com", port: "443", ruleType: "HTTPS", reason: "not in allowlist", count: 1 },
        { host: "unexpected.example.com", port: "443", ruleType: "HTTPS", reason: "not in allowlist", count: 1 },
      ],
      ["known-bad.example.com:443"],
    );
    const report = { mode: "restrict", sections: {} };
    const markdown = buildReportMarkdown(report, {
      actionRepo: "dash14/buildcage",
      actionRef: "v2",
      blockedRows,
      showExpected: true,
    });
    assert.match(markdown, /\| Host \| Rule \| Reason \| Count \| Expected \|/);
    assert.match(markdown, /\| known-bad\.example\.com:443 \| HTTPS \| not in allowlist \| 1 \| ✅ \|/);
    assert.match(markdown, /\| unexpected\.example\.com:443 \| HTTPS \| not in allowlist \| 1 \| {2}\|/);
  });

  it("omits the Expected column when known_blocked_rules is not set", () => {
    const blockedRows = annotateKnownBlocked(
      [{ host: "evil.example.com", port: "443", ruleType: "HTTPS", reason: "not in allowlist", count: 1 }],
      [],
    );
    const report = { mode: "restrict", sections: {} };
    const markdown = buildReportMarkdown(report, { actionRepo: "dash14/buildcage", actionRef: "v2", blockedRows });
    assert.doesNotMatch(markdown, /Expected/);
  });
});

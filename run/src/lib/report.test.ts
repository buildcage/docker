/**
 * Unit tests for run/lib/report.ts — specifically writeReport's exit-code
 * semantics. `process.exitCode = 1` here is only ever additive on top of
 * the isolated command's own exit code (see main.ts), never resetting it
 * back to success.
 */
import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  writeReport,
  buildReportMarkdown,
  type Report,
  type WriteReportOptions,
} from "./report.ts";
import { annotateKnownBlocked } from "../../../core/lib/report/known-blocked.ts";
import { withScratchDir } from "./isolated-exec.ts";
import type { GenReportParameters } from "../../../core/lib/report/report-data.ts";

// writeReport reads GITHUB_STEP_SUMMARY/BUILDCAGE_RUN_DEBUG_SUMMARY_FILE
// from process.env and mutates process.exitCode directly (mirroring what
// main.ts itself does) -- both are saved/restored per test so a test here
// can never leak into another test in this file, another test file, or
// (critically) into `node --test`'s own final exit status.
let prevEnv: NodeJS.ProcessEnv;
let prevExitCode: number | string | null | undefined;

beforeEach(() => {
  prevEnv = { ...process.env };
  prevExitCode = process.exitCode;
  process.exitCode = undefined;
});

afterEach(() => {
  process.env = prevEnv;
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

// blocked rows are already expected to be annotated by the time a Report
// reaches writeReport/buildReportMarkdown (see build-transparent-report-data.ts)
// — this mirrors that, applying parameters.knownBlockedRules the same way.
function report(overrides: Partial<Report> = {}): Report {
  const params = overrides.parameters ?? parameters();
  return {
    engine: "transparent",
    parameters: params,
    passed: [],
    blocked: [],
    blockedCount: 0,
    logLooksPlausible: true,
    ...overrides,
  };
}

function writeReportWithSummary(r: Report, opts: WriteReportOptions) {
  return withScratchDir((dir) => {
    const summaryPath = join(dir, "summary.md");
    writeFileSync(summaryPath, "");
    process.env.GITHUB_STEP_SUMMARY = summaryPath;
    delete process.env.BUILDCAGE_RUN_DEBUG_SUMMARY_FILE;
    writeReport(r, opts);
    return process.exitCode;
  });
}

describe("writeReport", () => {
  it("leaves exitCode untouched when there are no blocked connections", () => {
    const r = report({ blockedCount: 0 });
    assert.equal(writeReportWithSummary(r, { failOnBlocked: true }), undefined);
  });

  it("sets exitCode=1 when blocked connections are detected and failOnBlocked is true", () => {
    const r = report({
      blockedCount: 2,
      blocked: annotateKnownBlocked(
        [
          {
            host: "bad.example.com",
            port: "443",
            ruleType: "HTTPS",
            reason: "not in allowlist",
            count: 2,
          },
        ],
        [],
      ),
    });
    assert.equal(writeReportWithSummary(r, { failOnBlocked: true }), 1);
  });

  it("leaves exitCode untouched when failOnBlocked is false, even with blocked connections", () => {
    const r = report({
      blockedCount: 2,
      blocked: annotateKnownBlocked(
        [
          {
            host: "bad.example.com",
            port: "443",
            ruleType: "HTTPS",
            reason: "not in allowlist",
            count: 2,
          },
        ],
        [],
      ),
    });
    assert.equal(writeReportWithSummary(r, { failOnBlocked: false }), undefined);
  });

  it("leaves exitCode untouched in audit mode even when failOnBlocked is true", () => {
    const r = report({
      parameters: parameters({ mode: "audit" }),
      blockedCount: 2,
      blocked: annotateKnownBlocked(
        [
          {
            host: "bad.example.com",
            port: "443",
            ruleType: "HTTPS",
            reason: "not in allowlist",
            count: 2,
          },
        ],
        [],
      ),
    });
    assert.equal(writeReportWithSummary(r, { failOnBlocked: true }), undefined);
  });

  it("leaves exitCode untouched when every blocked connection matches known_blocked_rules", () => {
    const knownBlockedRules = ["known-bad.example.com:443"];
    const r = report({
      parameters: parameters({ knownBlockedRules }),
      blockedCount: 3,
      blocked: annotateKnownBlocked(
        [
          {
            host: "known-bad.example.com",
            port: "443",
            ruleType: "HTTPS",
            reason: "not in allowlist",
            count: 3,
          },
        ],
        knownBlockedRules,
      ),
    });
    assert.equal(writeReportWithSummary(r, { failOnBlocked: true }), undefined);
  });

  it("sets exitCode=1 when some blocked rows don't match known_blocked_rules", () => {
    const knownBlockedRules = ["known-bad.example.com:443"];
    const r = report({
      parameters: parameters({ knownBlockedRules }),
      blockedCount: 4,
      blocked: annotateKnownBlocked(
        [
          {
            host: "known-bad.example.com",
            port: "443",
            ruleType: "HTTPS",
            reason: "not in allowlist",
            count: 3,
          },
          {
            host: "unexpected.example.com",
            port: "443",
            ruleType: "HTTPS",
            reason: "not in allowlist",
            count: 1,
          },
        ],
        knownBlockedRules,
      ),
    });
    assert.equal(writeReportWithSummary(r, { failOnBlocked: true }), 1);
  });

  it("leaves exitCode untouched in audit mode even with known_blocked_rules set", () => {
    const knownBlockedRules = ["known-bad.example.com:443"];
    const r = report({
      parameters: parameters({ mode: "audit", knownBlockedRules }),
      blockedCount: 1,
      blocked: annotateKnownBlocked(
        [{ host: "known-bad.example.com", port: "443", ruleType: "HTTPS", reason: "-", count: 1 }],
        knownBlockedRules,
      ),
    });
    assert.equal(writeReportWithSummary(r, { failOnBlocked: true }), undefined);
  });

  // Audit's outcome never depends on known_blocked_rules matching, so the
  // notice text shouldn't either.
  it("audit-mode notice text stays fixed even when known_blocked_rules matches every blocked connection", (t) => {
    const log = t.mock.method(console, "log", () => {});
    const knownBlockedRules = ["known-bad.example.com:443"];
    const r = report({
      parameters: parameters({ mode: "audit", knownBlockedRules }),
      blockedCount: 2,
      blocked: annotateKnownBlocked(
        [{ host: "known-bad.example.com", port: "443", ruleType: "HTTPS", reason: "-", count: 2 }],
        knownBlockedRules,
      ),
    });
    writeReportWithSummary(r, { failOnBlocked: true });
    assert.equal(log.mock.calls.length, 1);
    assert.equal(
      log.mock.calls[0].arguments[0],
      "::notice::2 blocked connection(s) detected by buildcage sandbox",
    );
  });
});

describe("buildReportMarkdown", () => {
  it("includes a restrict-mode example (as a `run` step) in audit mode with audited hosts", () => {
    const r = report({
      parameters: parameters({ mode: "audit" }),
      passed: [
        { host: "registry.npmjs.org", port: "443", ruleType: "HTTPS", reason: "-", count: 3 },
      ],
    });
    const markdown = buildReportMarkdown(r, {
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
    const r = report({
      passed: [
        { host: "registry.npmjs.org", port: "443", ruleType: "HTTPS", reason: "-", count: 3 },
      ],
    });
    const markdown = buildReportMarkdown(r, { actionRepo: "dash14/buildcage", actionRef: "v2" });
    assert.doesNotMatch(markdown, /Switch to restrict mode/);
  });

  it("omits the restrict-mode example in audit mode with no audited hosts", () => {
    const r = report({ parameters: parameters({ mode: "audit" }) });
    const markdown = buildReportMarkdown(r, { actionRepo: "dash14/buildcage", actionRef: "v2" });
    assert.doesNotMatch(markdown, /Switch to restrict mode/);
  });

  it("uses a level-2 heading matching the report action's wording", () => {
    const markdown = buildReportMarkdown(report(), {
      actionRepo: "dash14/buildcage",
      actionRef: "v2",
    });
    assert.match(markdown, /^## Outbound Traffic Report \(restrict mode\)\n/);
  });

  it("appends stepLabel to the heading to tell steps apart", () => {
    const markdown = buildReportMarkdown(report(), {
      actionRepo: "dash14/buildcage",
      actionRef: "v2",
      stepLabel: "npm install",
    });
    assert.match(markdown, /^## Outbound Traffic Report — npm install \(restrict mode\)\n/);
  });

  it("renders just the heading, no tables, when nothing passed or was blocked", () => {
    const markdown = buildReportMarkdown(report(), { stepLabel: "npm install" });
    assert.match(markdown, /^## Outbound Traffic Report — npm install \(restrict mode\)\n\n$/);
  });

  it("adds an Expected column marking known_blocked_rules matches when set", () => {
    const knownBlockedRules = ["known-bad.example.com:443"];
    const blocked = annotateKnownBlocked(
      [
        {
          host: "known-bad.example.com",
          port: "443",
          ruleType: "HTTPS",
          reason: "not in allowlist",
          count: 1,
        },
        {
          host: "unexpected.example.com",
          port: "443",
          ruleType: "HTTPS",
          reason: "not in allowlist",
          count: 1,
        },
      ],
      knownBlockedRules,
    );
    const r = report({ parameters: parameters({ knownBlockedRules }), blocked, blockedCount: 2 });
    const markdown = buildReportMarkdown(r, { actionRepo: "dash14/buildcage", actionRef: "v2" });
    assert.match(markdown, /\| Host \| Rule \| Reason \| Count \| Expected \|/);
    assert.match(
      markdown,
      /\| known-bad\.example\.com:443 \| HTTPS \| not in allowlist \| 1 \| ✅ \|/,
    );
    assert.match(
      markdown,
      /\| unexpected\.example\.com:443 \| HTTPS \| not in allowlist \| 1 \| {2}\|/,
    );
  });

  it("omits the Expected column when known_blocked_rules is not set", () => {
    const blocked = annotateKnownBlocked(
      [
        {
          host: "evil.example.com",
          port: "443",
          ruleType: "HTTPS",
          reason: "not in allowlist",
          count: 1,
        },
      ],
      [],
    );
    const r = report({ blocked, blockedCount: 1 });
    const markdown = buildReportMarkdown(r, { actionRepo: "dash14/buildcage", actionRef: "v2" });
    assert.doesNotMatch(markdown, /Expected/);
  });
});

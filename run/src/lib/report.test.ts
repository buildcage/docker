import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { computeReportOutcome, buildReportMarkdown, type Report } from "./report.ts";
import { annotateKnownBlocked } from "../../../core/lib/report/known-blocked.ts";
import type { GenReportParameters } from "../../../core/lib/report/report-data.ts";

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
// reaches computeReportOutcome/buildReportMarkdown (see build-transparent-report-data.ts)
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

describe("computeReportOutcome", () => {
  it("does not fail when there are no blocked connections", () => {
    const r = report({ blockedCount: 0 });
    assert.equal(computeReportOutcome(r, { failOnBlocked: true }).shouldFail, false);
  });

  it("fails when blocked connections are detected and failOnBlocked is true", () => {
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
    assert.equal(computeReportOutcome(r, { failOnBlocked: true }).shouldFail, true);
  });

  it("does not fail when failOnBlocked is false, even with blocked connections", () => {
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
    assert.equal(computeReportOutcome(r, { failOnBlocked: false }).shouldFail, false);
  });

  it("does not fail in audit mode even when failOnBlocked is true", () => {
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
    assert.equal(computeReportOutcome(r, { failOnBlocked: true }).shouldFail, false);
  });

  it("does not fail when every blocked connection matches known_blocked_rules", () => {
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
    assert.equal(computeReportOutcome(r, { failOnBlocked: true }).shouldFail, false);
  });

  it("fails when some blocked rows don't match known_blocked_rules", () => {
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
    assert.equal(computeReportOutcome(r, { failOnBlocked: true }).shouldFail, true);
  });

  it("does not fail in audit mode even with known_blocked_rules set", () => {
    const knownBlockedRules = ["known-bad.example.com:443"];
    const r = report({
      parameters: parameters({ mode: "audit", knownBlockedRules }),
      blockedCount: 1,
      blocked: annotateKnownBlocked(
        [{ host: "known-bad.example.com", port: "443", ruleType: "HTTPS", reason: "-", count: 1 }],
        knownBlockedRules,
      ),
    });
    assert.equal(computeReportOutcome(r, { failOnBlocked: true }).shouldFail, false);
  });

  // Audit's outcome never depends on known_blocked_rules matching, so the
  // notice text shouldn't either.
  it("audit-mode notice text stays fixed even when known_blocked_rules matches every blocked connection", () => {
    const knownBlockedRules = ["known-bad.example.com:443"];
    const r = report({
      parameters: parameters({ mode: "audit", knownBlockedRules }),
      blockedCount: 2,
      blocked: annotateKnownBlocked(
        [{ host: "known-bad.example.com", port: "443", ruleType: "HTTPS", reason: "-", count: 2 }],
        knownBlockedRules,
      ),
    });
    const outcome = computeReportOutcome(r, { failOnBlocked: true });
    assert.equal(outcome.level, "notice");
    assert.equal(outcome.message, "2 blocked connection(s) detected by buildcage sandbox");
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

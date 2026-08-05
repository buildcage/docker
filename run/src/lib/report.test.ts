import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { computeReportOutcome, type Report, type ComputeReportOutcomeOptions } from "./report.ts";
import { annotateKnownBlocked } from "../../../core/lib/report/build/annotate-known-blocked.ts";
import type { GenReportParameters } from "../../../core/lib/report/types.ts";

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

function options(
  overrides: Partial<ComputeReportOutcomeOptions> = {},
): ComputeReportOutcomeOptions {
  return { actionRepo: "dash14/buildcage", actionRef: "v2", ...overrides };
}

// blocked rows are already expected to be annotated by the time a Report
// reaches computeReportOutcome — this mirrors that, applying
// parameters.knownBlockedRules the same way.
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

// The decision matrix itself is tested elsewhere; these only verify
// shouldFail and the rendered markdown combine correctly.
// The decision matrix itself is tested elsewhere; these only verify
// shouldFail and the rendered markdown combine correctly. Markdown content
// itself is covered by render-report-markdown.test.ts, which
// computeReportOutcome delegates to.
describe("computeReportOutcome", () => {
  it("does not fail when there are no blocked connections", () => {
    const r = report({ blockedCount: 0 });
    assert.equal(computeReportOutcome(r, options({ failOnBlocked: true })).shouldFail, false);
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
    assert.equal(computeReportOutcome(r, options({ failOnBlocked: true })).shouldFail, true);
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
    const outcome = computeReportOutcome(r, options({ failOnBlocked: true }));
    assert.equal(outcome.level, "notice");
    assert.equal(outcome.message, "2 blocked connection(s) detected by buildcage sandbox");
  });

  it("passes stepLabel/runCommand through to the rendered markdown", () => {
    const r = report({
      parameters: parameters({ mode: "audit" }),
      passed: [
        { host: "registry.npmjs.org", port: "443", ruleType: "HTTPS", reason: "-", count: 3 },
      ],
    });
    const { markdown } = computeReportOutcome(
      r,
      options({ stepLabel: "npm install", runCommand: "npm install" }),
    );
    assert.match(markdown, /^## Outbound Traffic Report — npm install \(audit mode\)/);
    assert.match(markdown, /uses: dash14\/buildcage\/run@v2/);
    assert.match(markdown, /run: \|\n\s+npm install/);
  });
});

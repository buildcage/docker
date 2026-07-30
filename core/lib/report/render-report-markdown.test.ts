import { describe, it, assert, reportResults } from "../test/test-shim.ts";
import { renderReportMarkdown } from "./render-report-markdown.ts";
import type { GenReportParameters, TransparentReportData, ExplicitReportData } from "./report-data.ts";

function params(overrides: Partial<GenReportParameters> = {}): GenReportParameters {
  return {
    mode: "restrict",
    allowedHttpsRules: [],
    allowedHttpRules: [],
    allowedIpRules: [],
    knownBlockedRules: [],
    ...overrides,
  };
}

const allowedRow = { host: "good.com", port: "443", ruleType: "HTTPS", reason: "-", count: 1 };
const blockedRow = { host: "bad.com", port: "80", ruleType: "HTTP", reason: "not-allowed", count: 1, expected: false };

// test-shim's Assert interface has no doesNotMatch.
function assertNotMatch(value: string, pattern: RegExp): void {
  assert.equal(pattern.test(value), false);
}

describe("renderReportMarkdown — transparent", () => {
  const base: TransparentReportData = {
    engine: "transparent",
    parameters: params(),
    passed: [],
    blocked: [],
    blockedCount: 0,
    logLooksPlausible: true,
  };

  it("renders the restrict-mode heading and Allowed Hosts table", () => {
    const md = renderReportMarkdown({ ...base, passed: [allowedRow] }, "dash14/buildcage", "v2");
    assert.match(md, /## Outbound Traffic Report during Docker Build \(restrict mode\)/);
    assert.match(md, /### ✅ Allowed Hosts/);
    assert.match(md, /good\.com/);
  });

  it("renders the audit-mode heading and Audited Hosts table, plus a restrict-mode example", () => {
    const md = renderReportMarkdown(
      { ...base, parameters: params({ mode: "audit" }), passed: [allowedRow] },
      "dash14/buildcage",
      "v2",
    );
    assert.match(md, /### 📋 Audited Hosts/);
    assert.match(md, /Switch to restrict mode/);
  });

  it("renders Blocked Hosts and shows the SNI footnote, not Communication details", () => {
    const md = renderReportMarkdown({ ...base, blocked: [blockedRow], blockedCount: 1 }, "dash14/buildcage", "v2");
    assert.match(md, /### 🚫 Blocked Hosts/);
    assert.match(md, /based on the Host header/);
    assertNotMatch(md, /Communication details/);
  });

  it("uses the real actionRepo in the footer, not a placeholder", () => {
    const md = renderReportMarkdown(base, "dash14/buildcage", "v2");
    assert.match(md, /Reported by \[Buildcage\]\(https:\/\/github\.com\/dash14\/buildcage\)/);
    assertNotMatch(md, /GITHUB_ACTION_REPOSITORY/);
  });

  it("omits the Allowed Hosts table entirely when nothing passed", () => {
    const md = renderReportMarkdown(base, "dash14/buildcage", "v2");
    assertNotMatch(md, /### ✅ Allowed Hosts/);
  });

  it("shows a '(no communication)' note when nothing passed and nothing blocked", () => {
    const md = renderReportMarkdown(base, "dash14/buildcage", "v2");
    assert.match(md, /_\(no communication\)_/);
  });

  it("omits the '(no communication)' note once anything passed or was blocked", () => {
    const passedMd = renderReportMarkdown({ ...base, passed: [allowedRow] }, "dash14/buildcage", "v2");
    assertNotMatch(passedMd, /_\(no communication\)_/);

    const blockedMd = renderReportMarkdown({ ...base, blocked: [blockedRow], blockedCount: 1 }, "dash14/buildcage", "v2");
    assertNotMatch(blockedMd, /_\(no communication\)_/);
  });
});

describe("renderReportMarkdown — explicit", () => {
  const base: ExplicitReportData = {
    engine: "explicit",
    parameters: params(),
    passed: [allowedRow],
    blocked: [blockedRow],
    blockedCount: 1,
    logLooksPlausible: true,
    proxyLogs: {
      builds: [
        [
          {
            command: "[2/3] RUN curl https://good.com/",
            started: "2026-01-01T00:00:00Z",
            completed: "2026-01-01T00:00:01Z",
            entries: [{ method: "GET", url: "https://good.com/", status: 200 }],
          },
        ],
      ],
      denied: [{ url: "https://bad.com/", timestamp: "2026-01-01T00:00:02Z" }],
    },
  };

  it("renders Communication details instead of the SNI footnote", () => {
    const md = renderReportMarkdown(base, "dash14/buildcage", "v2");
    assert.match(md, /Communication details/);
    assert.match(md, /Allowed Urls/);
    assert.match(md, /Blocked Urls/);
    assertNotMatch(md, /based on the Host header/);
  });
});

reportResults();

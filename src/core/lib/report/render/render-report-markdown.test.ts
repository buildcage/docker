import { describe, it, expect, reportResults } from "#core/lib/test/test-shim.ts";
import { renderReportMarkdown } from "./render-report-markdown.ts";
import type { GenReportParameters, UniversalReportData, ExplicitReportData } from "../types.ts";

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
const blockedRow = {
  host: "bad.com",
  port: "80",
  ruleType: "HTTP",
  reason: "not-allowed",
  count: 1,
  expected: false,
};

// test-shim's Assert interface has no doesNotMatch.
function assertNotMatch(value: string, pattern: RegExp): void {
  expect(pattern.test(value)).toBe(false);
}

describe("renderReportMarkdown — universal", () => {
  const base: UniversalReportData = {
    engine: "universal",
    parameters: params(),
    passed: [],
    blocked: [],
    blockedCount: 0,
    logLooksPlausible: true,
  };

  it("renders a bare restrict-mode title, since that is the day-to-day mode", () => {
    const md = renderReportMarkdown({ ...base, passed: [allowedRow] }, "buildcage/docker", "v2");
    expect(md).toMatch(/^## Outbound Traffic Report\n/);
    assertNotMatch(md, /restrict mode\)/);
    expect(md).toMatch(/### ✅ Allowed Hosts/);
    expect(md).toMatch(/good\.com/);
  });

  it("renders the audit-mode heading and Audited Hosts table, plus a restrict-mode example", () => {
    const md = renderReportMarkdown(
      { ...base, parameters: params({ mode: "audit" }), passed: [allowedRow] },
      "buildcage/docker",
      "v2",
    );
    expect(md).toMatch(/^## Outbound Traffic Report \(audit mode\)\n/);
    expect(md).toMatch(/### 📋 Audited Hosts/);
    expect(md).toMatch(/Switch to restrict mode/);
  });

  it("renders Blocked Hosts and shows the SNI footnote, not Communication details", () => {
    const md = renderReportMarkdown(
      { ...base, blocked: [blockedRow], blockedCount: 1 },
      "buildcage/docker",
      "v2",
    );
    expect(md).toMatch(/### 🚫 Blocked Hosts/);
    expect(md).toMatch(/based on the Host header/);
    assertNotMatch(md, /Communication details/);
  });

  it("uses the real actionRepo in the footer, not a placeholder", () => {
    const md = renderReportMarkdown(base, "buildcage/docker", "v2");
    expect(md).toMatch(
      /Reported by \[buildcage\/docker\]\(https:\/\/github\.com\/buildcage\/docker\)/,
    );
    assertNotMatch(md, /GITHUB_ACTION_REPOSITORY/);
  });

  it("omits the Allowed Hosts table entirely when nothing passed", () => {
    const md = renderReportMarkdown(base, "buildcage/docker", "v2");
    assertNotMatch(md, /### ✅ Allowed Hosts/);
  });

  it("shows a '(no communication)' note when nothing passed and nothing blocked", () => {
    const md = renderReportMarkdown(base, "buildcage/docker", "v2");
    expect(md).toMatch(/_\(no communication\)_/);
  });

  it("omits the '(no communication)' note once anything passed or was blocked", () => {
    const passedMd = renderReportMarkdown(
      { ...base, passed: [allowedRow] },
      "buildcage/docker",
      "v2",
    );
    assertNotMatch(passedMd, /_\(no communication\)_/);

    const blockedMd = renderReportMarkdown(
      { ...base, blocked: [blockedRow], blockedCount: 1 },
      "buildcage/docker",
      "v2",
    );
    assertNotMatch(blockedMd, /_\(no communication\)_/);
  });

  it("uses the title option verbatim, e.g. a run step's em-dash label", () => {
    const md = renderReportMarkdown(base, "buildcage/docker", "v2", {
      title: "Outbound Traffic Report — npm install",
    });
    expect(md).toMatch(/^## Outbound Traffic Report — npm install\n/);
  });

  it("adds an Expected column marking known_blocked_rules matches when set", () => {
    const md = renderReportMarkdown(
      { ...base, parameters: params({ knownBlockedRules: ["bad.com:80"] }), blocked: [blockedRow] },
      "buildcage/docker",
      "v2",
    );
    expect(md).toMatch(/\| Host \| Rule \| Reason \| Count \| Expected \|/);
  });

  it("omits the Expected column when known_blocked_rules is not set", () => {
    const md = renderReportMarkdown({ ...base, blocked: [blockedRow] }, "buildcage/docker", "v2");
    assertNotMatch(md, /Expected/);
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
    const md = renderReportMarkdown(base, "buildcage/docker", "v2");
    expect(md).toMatch(/Communication details/);
    expect(md).toMatch(/Allowed Urls/);
    expect(md).toMatch(/Blocked Urls/);
    assertNotMatch(md, /based on the Host header/);
  });
});

reportResults();

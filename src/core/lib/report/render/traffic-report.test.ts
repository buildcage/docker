import { describe, it, expect } from "vitest";

import type { TrafficEvent } from "#core/lib/log/traffic-event.ts";
import { reportParams, expectedRows } from "#core/lib/test/report-data.node.ts";

import { renderReportMarkdown } from "../../test/render-report-markdown.node.ts";
import type { UniversalReportData, InspectReportData } from "../types.ts";

const allowedRow = { host: "good.com", port: "443", ruleType: "HTTPS", reason: "-", count: 1 };
const blockedRow = {
  host: "bad.com",
  port: "80",
  ruleType: "HTTP",
  reason: "not-allowed",
  count: 1,
  expected: false,
};

describe("renderReportMarkdown: universal", () => {
  const base: UniversalReportData = {
    engine: "universal",
    parameters: reportParams(),
    passed: [],
    blocked: [],
    failed: [],
    blockedCount: 0,
    logLooksPlausible: true,
    timeline: [],
    startedAt: undefined,
  };

  it("renders Blocked Hosts and shows the SNI footnote, not Communication details", () => {
    const md = renderReportMarkdown(
      { ...base, blocked: [blockedRow], blockedCount: 1 },
      "owner/repo",
      "v1",
    );
    expect(md).toMatch(/### 🚫 Blocked Hosts/);
    expect(md).toMatch(/based on the Host header/);
    expect(md).not.toMatch(/Communication details/);
  });

  it("omits the Allowed Hosts table entirely when nothing passed", () => {
    const md = renderReportMarkdown(base, "owner/repo", "v1");
    expect(md).not.toMatch(/### ✅ Allowed Hosts/);
  });

  it("shows a '(no communication)' note when nothing passed and nothing blocked", () => {
    const md = renderReportMarkdown(base, "owner/repo", "v1");
    expect(md).toMatch(/_\(no communication\)_/);
  });

  it("omits the '(no communication)' note once anything passed or was blocked", () => {
    const passedMd = renderReportMarkdown({ ...base, passed: [allowedRow] }, "owner/repo", "v1");
    expect(passedMd).not.toMatch(/_\(no communication\)_/);

    const blockedMd = renderReportMarkdown(
      { ...base, blocked: [blockedRow], blockedCount: 1 },
      "owner/repo",
      "v1",
    );
    expect(blockedMd).not.toMatch(/_\(no communication\)_/);
  });

  it("omits the '(no communication)' note for a run that only looked names up", () => {
    const discovery: TrafficEvent = {
      time: 1,
      action: "discovery",
      protocol: "dns",
      host: "_http._tcp.example.com",
      queryType: "SRV",
    };
    const md = renderReportMarkdown({ ...base, timeline: [discovery] }, "owner/repo", "v1");
    expect(md).not.toMatch(/_\(no communication\)_/);
    expect(md).toMatch(/Communication details/);
  });

  const failedRow = {
    host: "good.com",
    port: "443",
    ruleType: "HTTPS",
    reason: "origin-no-response",
    count: 1,
  };

  it("tables connections the origin broke with the blocks, marked apart", () => {
    const md = renderReportMarkdown(
      { ...base, blocked: [blockedRow], blockedCount: 1, failed: [failedRow] },
      "owner/repo",
      "v1",
    );
    expect(md).toMatch(/### 🚫 Blocked \/ ⚠️ Failed Hosts\n/);
    expect(md).toMatch(
      /\| `bad\.com:80` \| HTTP \| 🚫 not-allowed \| 1 \|\n\| `good\.com:443` \| HTTPS \| ⚠️ origin-no-response \| 1 \|/,
    );
    // The reader is told why the step passed regardless.
    expect(md).toMatch(/none of them fails the step/);
  });

  it("heads a table of failed connections alone as failed, and blocked alone as blocked", () => {
    const failedOnly = renderReportMarkdown({ ...base, failed: [failedRow] }, "owner/repo", "v1");
    expect(failedOnly).toMatch(/### ⚠️ Failed Hosts\n/);
    const blockedOnly = renderReportMarkdown(
      { ...base, blocked: [blockedRow], blockedCount: 1 },
      "owner/repo",
      "v1",
    );
    expect(blockedOnly).toMatch(/### 🚫 Blocked Hosts\n/);
    expect(blockedOnly).not.toMatch(/none of them fails the step/);
  });

  it("puts blocks and failures above the allowed hosts and the known blocked ones below", () => {
    const md = renderReportMarkdown(
      {
        ...base,
        parameters: reportParams({ knownBlockedRules: ["*.sury.org:*"] }),
        passed: [{ ...allowedRow, host: "ok.com" }],
        blocked: [...expectedRows, blockedRow],
        blockedCount: 3,
        failed: [failedRow],
      },
      "owner/repo",
      "v1",
    );
    const at = [
      "| `bad.com:80` |",
      "| `good.com:443` |",
      "### ✅ Allowed Hosts",
      "Known Blocked Hosts",
      "(2 hosts)",
    ].map((s) => md.indexOf(s));
    expect(at.every((i) => i !== -1)).toBe(true);
    expect(at).toStrictEqual(at.toSorted((a, b) => a - b));
  });

  it("does not call a run that only failed connections no communication", () => {
    const md = renderReportMarkdown({ ...base, failed: [failedRow] }, "owner/repo", "v1");
    expect(md).not.toContain("_(no communication)_");
  });

  it("suggests a host whose name failed to resolve in audit, which nothing blocked", () => {
    const dnsFailed = { ...failedRow, host: "flaky.example.com", reason: "dns-failed" };
    const md = renderReportMarkdown(
      { ...base, parameters: reportParams({ mode: "audit" }), failed: [dnsFailed] },
      "owner/repo",
      "v1",
    );
    expect(md).toMatch(/allowed-https-rules: >-\n\s+flaky\.example\.com:443\n/);
  });

  it("uses the title option verbatim, e.g. a run step's em-dash label", () => {
    const md = renderReportMarkdown(base, "owner/repo", "v1", {
      title: "Outbound Traffic Report — npm install",
    });
    expect(md).toMatch(/^## Outbound Traffic Report — npm install\n/);
  });

  it("shows a restrict-mode example including the step name and run: command", () => {
    const md = renderReportMarkdown(
      { ...base, parameters: reportParams({ mode: "audit" }), passed: [allowedRow] },
      "owner/repo",
      "v1",
      { stepName: "Start isolated-run", runCommand: "npm install" },
    );
    expect(md).toMatch(/- name: Start isolated-run\n/);
    expect(md).toMatch(/uses: owner\/repo@v1/);
    expect(md).toMatch(/run: \|\n\s+npm install/);
  });

  it("collapses the known-blocked-rules matches into their own details element", () => {
    const md = renderReportMarkdown(
      {
        ...base,
        parameters: reportParams({ knownBlockedRules: ["bad.com:80"] }),
        blocked: [{ ...blockedRow, expected: true, expectedBy: "bad.com:80" }],
      },
      "owner/repo",
      "v1",
    );
    expect(md).toContain(
      "<details>\n<summary>🚫 Known Blocked Hosts (1 host)</summary>\n\n" +
        "| Host | Rule | Reason | Count |\n| --- | --- | --- | ---: |\n" +
        "| `bad.com:80` (1 host) | HTTP | not-allowed | 1 |\n\n</details>\n",
    );
    expect(md).not.toMatch(/### 🚫 Blocked Hosts/);
  });

  it("separates the two tables when a run has both allowed and blocked hosts", () => {
    const md = renderReportMarkdown(
      { ...base, passed: [allowedRow], blocked: [blockedRow], blockedCount: 1 },
      "owner/repo",
      "v1",
    );
    expect(md).toMatch(/bad\.com[\s\S]*\n\n### ✅ Allowed Hosts/);
  });

  it("omits the known blocked hosts when no row matched known-blocked-rules", () => {
    const md = renderReportMarkdown({ ...base, blocked: [blockedRow] }, "owner/repo", "v1");
    expect(md).not.toMatch(/Known Blocked/);
  });

  it("folds the rows one known_blocked_rule matched into a single row naming the rule", () => {
    const md = renderReportMarkdown(
      {
        ...base,
        parameters: reportParams({ knownBlockedRules: ["*.sury.org:*"] }),
        blocked: expectedRows,
      },
      "owner/repo",
      "v1",
    );
    expect(md).toMatch(/\(2 hosts\)/);
    expect(md).not.toMatch(/\| `a\.sury\.org:443` \|/);
  });
});

// ---------------------------------------------------------------------------
// inspect
// ---------------------------------------------------------------------------
describe("renderReportMarkdown: inspect", () => {
  const t = 1787471975;
  const timeline: TrafficEvent[] = [
    {
      time: t,
      action: "allow",
      protocol: "https",
      host: "good.com",
      port: 443,
      method: "GET",
      url: "https://good.com/pkg",
      status: 200,
      bytes: 1,
    },
  ];
  const base: InspectReportData = {
    engine: "inspect",
    parameters: reportParams(),
    passed: [],
    blocked: [],
    failed: [],
    blockedCount: 0,
    logLooksPlausible: true,
    timeline: [],
    startedAt: t,
  };

  it("renders Communication details instead of the SNI footnote", () => {
    const md = renderReportMarkdown({ ...base, timeline }, "owner/repo", "v1");
    expect(md).toMatch(/Communication details/);
    expect(md).not.toMatch(/based on the Host header/);
  });

  it("builds the audit-mode example from the timeline, method and path included", () => {
    const md = renderReportMarkdown(
      { ...base, parameters: reportParams({ mode: "audit" }), timeline },
      "owner/repo",
      "v1",
      { runCommand: "npm install" },
    );
    expect(md).not.toMatch(/proxy-engine/);
    expect(md).toMatch(/allowed-url-rules: \|/);
    expect(md).toMatch(/GET https:\/\/good\.com\/pkg/);
    expect(md).toMatch(/run: \|\n\s+npm install/);
  });

  it("folds known-blocked-rules matches into one row naming the rule", () => {
    const md = renderReportMarkdown(
      {
        ...base,
        parameters: reportParams({ knownBlockedRules: ["*.sury.org:*"] }),
        blocked: [blockedRow, ...expectedRows],
      },
      "owner/repo",
      "v1",
    );
    expect(md).toMatch(/\| `\*\.sury\.org:\*` \(2 hosts\) \| HTTPS \| https-not-allowed \| 2 \|/);
    expect(md).not.toMatch(/a\.sury\.org/);
    expect(md).toMatch(/\| `bad\.com:80` \|/);
  });
});

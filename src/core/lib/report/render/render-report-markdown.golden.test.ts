/**
 * Full-text golden coverage of renderReportMarkdown.
 *
 * This is the Job Summary a user actually reads, assembled by one function
 * that branches on engine and mode and delegates to six renderers. The tests
 * next door assert that a given phrase appears; these pin the whole document,
 * so moving a section, reordering a table or losing a footnote is visible
 * even where nothing asserts on it.
 *
 * vitest-only (see test/golden.node.ts).
 */
import { describe, it } from "vitest";
import { renderReportMarkdown } from "./render-report-markdown.ts";
import type {
  GenReportParameters,
  ReportData,
  UniversalReportData,
  InspectReportData,
} from "../types.ts";
import type { TrafficEvent } from "#core/lib/log/traffic-event.ts";
import { expectMatchesGolden } from "#core/lib/test/golden.node.ts";
import { expectedRows, reportParams } from "#core/lib/test/report-data.node.ts";

/** Every golden document describes a run with one allowed rule. */
const params = (overrides: Partial<GenReportParameters> = {}) =>
  reportParams({ allowedHttpsRules: ["a.example.com:443"], ...overrides });

const passed = [
  { host: "a.example.com", port: "443", ruleType: "HTTPS", reason: "-", count: 3 },
  { host: "b.example.com", port: "80", ruleType: "HTTP", reason: "-", count: 1 },
];

const blocked = [
  {
    host: "bad.example.com",
    port: "443",
    ruleType: "HTTPS",
    reason: "https-not-allowed",
    count: 2,
    expected: false,
  },
];

/** A host the rules allow whose name the upstream resolver could not answer. */
const failed = [
  { host: "c.example.com", port: "443", ruleType: "HTTPS", reason: "dns-failed", count: 1 },
];

/** universal's timeline is coarse: a passthrough proxy sees a connection's
 *  host, port and bytes, never its method, URL or status. Its only richer
 *  events come from the resolver: a discovery lookup and a refused name. */
const universalTimeline: TrafficEvent[] = [
  {
    time: 1787471975,
    action: "allow",
    protocol: "https",
    host: "a.example.com",
    port: 443,
    bytes: 1024,
  },
  {
    time: 1787471977,
    action: "block",
    protocol: "https",
    host: "bad.example.com",
    port: 443,
    reason: "https-not-allowed",
  },
  {
    time: 1787471978,
    action: "discovery",
    protocol: "dns",
    host: "_http._tcp.a.example.com",
    queryType: "SRV",
  },
  {
    time: 1787471981,
    action: "failed",
    protocol: "https",
    host: "c.example.com",
    port: 443,
    reason: "dns-failed",
  },
];

const universal: UniversalReportData = {
  engine: "universal",
  parameters: params(),
  passed,
  blocked,
  failed,
  blockedCount: 2,
  logLooksPlausible: true,
  timeline: universalTimeline,
  startedAt: 1787471970,
};

const timeline: TrafficEvent[] = [
  {
    time: 1787471975,
    action: "allow",
    protocol: "https",
    host: "a.example.com",
    port: 443,
    method: "GET",
    url: "https://a.example.com/pkg.json",
    status: 200,
    bytes: 1024,
    destination: "93.184.216.34",
  },
  {
    time: 1787471977,
    action: "block",
    protocol: "https",
    host: "bad.example.com",
    port: 443,
    method: "GET",
    url: "https://bad.example.com/payload",
    reason: "https-not-allowed",
  },
  {
    time: 1787471978,
    action: "block",
    protocol: "dns",
    host: "unresolvable.example.net",
    queryType: "A",
    reason: "dns-not-allowed",
  },
  // Kept: nothing else reached this host, so its close shows (see clientEndedNoise).
  {
    time: 1787471979.123,
    action: "incomplete",
    protocol: "https",
    host: "untrusted-ca.example.com",
    port: 443,
    reason: "client-aborted",
    destination: "198.19.255.1:443",
  },
  // A host the rules allow, so its own table rather than the blocked one.
  {
    time: 1787471981,
    action: "failed",
    protocol: "https",
    host: "a.example.com",
    port: 443,
    method: "GET",
    url: "https://a.example.com/pkg.json",
    reason: "origin-aborted",
    destination: "93.184.216.34",
  },
];

const inspect: InspectReportData = {
  engine: "inspect",
  parameters: params(),
  passed,
  blocked,
  failed: [
    { host: "a.example.com", port: "443", ruleType: "HTTPS", reason: "origin-aborted", count: 1 },
  ],
  blockedCount: 1,
  logLooksPlausible: true,
  timeline,
  startedAt: 1787471970,
};

function audit<T extends ReportData>(report: T): T {
  return { ...report, parameters: params({ mode: "audit" }) };
}

const CASES: Record<string, ReportData> = {
  "universal-restrict": universal,
  "universal-audit": audit(universal),
  // The incomplete-log banner sits above the tables and applies to every engine.
  "universal-incomplete": { ...universal, logLooksPlausible: false },
  // Nothing happened at all: the "(no communication)" note, no tables, no
  // timeline (a discovery-only run keeps a timeline; see the unit tests).
  "universal-empty": {
    ...universal,
    passed: [],
    blocked: [],
    failed: [],
    blockedCount: 0,
    timeline: [],
  },
  // The Expected column, with the known_blocked_rules rows folded into one.
  "universal-expected": {
    ...universal,
    parameters: params({ knownBlockedRules: ["*.sury.org:*"] }),
    blocked: [...blocked, ...expectedRows],
    blockedCount: 4,
  },
  "inspect-restrict": inspect,
  "inspect-audit": audit(inspect),
};

describe("renderReportMarkdown golden files", () => {
  for (const [name, report] of Object.entries(CASES)) {
    it(`matches __fixtures__/${name}.md`, () => {
      expectMatchesGolden(
        // A fixed actionVersion keeps the restrict-mode example's `uses:` line
        // from drifting with the repo's own version.
        renderReportMarkdown(report, "owner/repo", "v2", { actionVersion: "2.1.0" }),
        new URL(`./__fixtures__/${name}.md`, import.meta.url),
      );
    });
  }
});

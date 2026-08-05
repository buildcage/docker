import { describe, it, assert, reportResults } from "../../test/test-shim.ts";
import { buildExplicitReportData } from "./explicit.ts";
import type { GenReportParameters } from "../types.ts";
import type { VertexAllowedEntry } from "../../log/vertex.ts";

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

const deniedLine =
  'time="2026-01-01T00:00:00Z" level=debug msg="Evaluated source policy" ' +
  'error="source \\"https://blocked.example.com/\\" denied by policy: source denied by policy" ' +
  'mutated=false orig="identifier:\\"https://blocked.example.com/\\"" ' +
  'ref="https://blocked.example.com/" updated="https://blocked.example.com/"';

const builds: VertexAllowedEntry[][] = [
  [
    {
      command: "[2/3] RUN curl https://good.example.com/",
      started: "2026-01-01T00:00:00Z",
      completed: "2026-01-01T00:00:01Z",
      entries: [{ method: "GET", url: "https://good.example.com/", status: 200 }],
    },
  ],
];

describe("buildExplicitReportData", () => {
  it("aggregates passed from builds and blocked from the buildkitd log", async () => {
    const result = await buildExplicitReportData(deniedLine.split("\n"), builds, params());
    assert.equal(result.engine, "explicit");
    assert.equal(result.passed.length, 1);
    assert.equal(result.passed[0].host, "good.example.com");
    assert.equal(result.blocked.length, 1);
    assert.equal(result.blocked[0].host, "blocked.example.com");
    assert.equal(result.blockedCount, 1);
  });

  it("blockedCount equals blocked.length (aggregated, not raw event count)", async () => {
    const twoDenials = [deniedLine, deniedLine].join("\n");
    const result = await buildExplicitReportData(twoDenials.split("\n"), [], params());
    assert.equal(result.blocked.length, 1);
    assert.equal(result.blockedCount, 1);
  });

  it("annotates blocked rows against knownBlockedRules", async () => {
    const result = await buildExplicitReportData(
      deniedLine.split("\n"),
      [],
      params({ knownBlockedRules: ["blocked.example.com:443"] }),
    );
    assert.equal(result.blocked[0].expected, true);
  });

  it("populates proxyLogs.builds and proxyLogs.denied", async () => {
    const result = await buildExplicitReportData(deniedLine.split("\n"), builds, params());
    assert.equal(result.proxyLogs.builds, builds);
    assert.equal(result.proxyLogs.denied.length, 1);
    assert.equal(result.proxyLogs.denied[0].url, "https://blocked.example.com/");
  });

  it("uses AUDIT decision for passed when mode is audit", async () => {
    const result = await buildExplicitReportData("".split("\n"), builds, params({ mode: "audit" }));
    assert.equal(result.passed.length, 1);
  });

  it("returns empty passed/blocked and blockedCount 0 for empty inputs", async () => {
    const result = await buildExplicitReportData("".split("\n"), [], params());
    assert.deepEqual(result.passed, []);
    assert.deepEqual(result.blocked, []);
    assert.equal(result.blockedCount, 0);
    assert.equal(result.logLooksPlausible, false);
  });

  it("logLooksPlausible is true for a genuinely quiet run (buildkitd's own startup noise, zero denials)", async () => {
    const log = 'time="2026-01-01T00:00:00Z" level=info msg="found worker" builder=0';
    const result = await buildExplicitReportData(log.split("\n"), [], params());
    assert.equal(result.blockedCount, 0);
    assert.equal(result.logLooksPlausible, true);
  });
});

reportResults();

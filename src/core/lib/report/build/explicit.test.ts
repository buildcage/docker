import { describe, it, expect, reportResults } from "#core/lib/test/test-shim.ts";
import { buildExplicitReportData } from "./explicit.ts";
import type { GenReportParameters } from "../types.ts";
import type { VertexAllowedEntry } from "#core/lib/log/vertex.ts";

function params(overrides: Partial<GenReportParameters> = {}): GenReportParameters {
  return {
    mode: "restrict",
    allowedHttpsRules: [],
    allowedHttpRules: [],
    allowedIpRules: [],
    allowTlsRules: [],
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
    expect(result.engine).toBe("explicit");
    expect(result.passed.length).toBe(1);
    expect(result.passed[0].host).toBe("good.example.com");
    expect(result.blocked.length).toBe(1);
    expect(result.blocked[0].host).toBe("blocked.example.com");
    expect(result.blockedCount).toBe(1);
  });

  it("blockedCount equals blocked.length (aggregated, not raw event count)", async () => {
    const twoDenials = [deniedLine, deniedLine].join("\n");
    const result = await buildExplicitReportData(twoDenials.split("\n"), [], params());
    expect(result.blocked.length).toBe(1);
    expect(result.blockedCount).toBe(1);
  });

  it("annotates blocked rows against knownBlockedRules", async () => {
    const result = await buildExplicitReportData(
      deniedLine.split("\n"),
      [],
      params({ knownBlockedRules: ["blocked.example.com:443"] }),
    );
    expect(result.blocked[0].expected).toBe(true);
  });

  it("populates proxyLogs.builds and proxyLogs.denied", async () => {
    const result = await buildExplicitReportData(deniedLine.split("\n"), builds, params());
    expect(result.proxyLogs.builds).toBe(builds);
    expect(result.proxyLogs.denied.length).toBe(1);
    expect(result.proxyLogs.denied[0].url).toBe("https://blocked.example.com/");
  });

  it("uses AUDIT decision for passed when mode is audit", async () => {
    const result = await buildExplicitReportData("".split("\n"), builds, params({ mode: "audit" }));
    expect(result.passed.length).toBe(1);
  });

  it("returns empty passed/blocked and blockedCount 0 for empty inputs", async () => {
    const result = await buildExplicitReportData("".split("\n"), [], params());
    expect(result.passed).toStrictEqual([]);
    expect(result.blocked).toStrictEqual([]);
    expect(result.blockedCount).toBe(0);
    expect(result.logLooksPlausible).toBe(false);
  });

  it("logLooksPlausible is true for a genuinely quiet run (buildkitd's own startup noise, zero denials)", async () => {
    const log = 'time="2026-01-01T00:00:00Z" level=info msg="found worker" builder=0';
    const result = await buildExplicitReportData(log.split("\n"), [], params());
    expect(result.blockedCount).toBe(0);
    expect(result.logLooksPlausible).toBe(true);
  });
});

reportResults();

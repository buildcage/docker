import { describe, it, expect, reportResults } from "#core/lib/test/test-shim.ts";
import { annotateKnownBlocked, aggregateAllowedHosts } from "./aggregate.ts";

describe("annotateKnownBlocked", () => {
  const row = (overrides = {}) => ({
    host: "evil.example.com",
    port: "443",
    ruleType: "HTTPS",
    reason: "not in allowlist",
    count: 3,
    ...overrides,
  });

  it("marks all rows as not expected when no rules are given", () => {
    const result = annotateKnownBlocked([row()], []);
    expect(result[0].expected).toBe(false);
  });

  it("marks a row as expected on an exact host:port match", () => {
    const result = annotateKnownBlocked([row()], ["evil.example.com:443"]);
    expect(result[0].expected).toBe(true);
  });

  it("marks a row as expected on a wildcard match", () => {
    const result = annotateKnownBlocked([row()], ["*.example.com:443"]);
    expect(result[0].expected).toBe(true);
  });

  it("marks a row as expected on a ~regex match", () => {
    const result = annotateKnownBlocked([row()], ["~^evil\\.example\\.com:443$"]);
    expect(result[0].expected).toBe(true);
  });

  it("does not match when the port differs", () => {
    const result = annotateKnownBlocked([row({ port: "80" })], ["evil.example.com:443"]);
    expect(result[0].expected).toBe(false);
  });

  it("preserves the original row fields", () => {
    const result = annotateKnownBlocked([row()], []);
    expect(result[0].host).toBe("evil.example.com");
    expect(result[0].port).toBe("443");
    expect(result[0].ruleType).toBe("HTTPS");
    expect(result[0].reason).toBe("not in allowlist");
    expect(result[0].count).toBe(3);
  });

  it("annotates each row independently across a mixed list", () => {
    const result = annotateKnownBlocked(
      [row({ host: "known.example.com" }), row({ host: "unknown.example.com" })],
      ["known.example.com:443"],
    );
    expect(result[0].expected).toBe(true);
    expect(result[1].expected).toBe(false);
  });
});

describe("aggregateAllowedHosts", () => {
  it("aggregates entries across multiple vertices within one build", () => {
    const builds = [
      [
        { entries: [{ method: "GET", url: "https://allowed.example.com/", status: 200 }] },
        { entries: [{ method: "GET", url: "https://allowed.example.com/", status: 200 }] },
      ],
    ];
    expect(aggregateAllowedHosts(builds, "ALLOWED")).toStrictEqual([
      { host: "allowed.example.com", port: "443", ruleType: "HTTPS", reason: "-", count: 2 },
    ]);
  });

  it("aggregates entries across multiple builds", () => {
    const builds = [
      [{ entries: [{ method: "GET", url: "https://allowed.example.com/one" }] }],
      [{ entries: [{ method: "GET", url: "https://allowed.example.com/two" }] }],
    ];
    const result = aggregateAllowedHosts(builds, "ALLOWED");
    expect(result.length).toBe(1);
    expect(result[0].count).toBe(2);
  });

  it("uses the given decision label", () => {
    const builds = [[{ entries: [{ method: "GET", url: "https://allowed.example.com/" }] }]];
    expect(aggregateAllowedHosts(builds, "ALLOWED")[0]?.count).toBe(1);
    // decision itself isn't part of the aggregated shape (aggregate() drops it),
    // but distinct decisions must not collide during aggregation
    const mixed = [[{ entries: [{ method: "GET", url: "https://allowed.example.com/" }] }]];
    expect(aggregateAllowedHosts(mixed, "AUDIT")).toStrictEqual([
      { host: "allowed.example.com", port: "443", ruleType: "HTTPS", reason: "-", count: 1 },
    ]);
  });

  it("skips vertices with no entries", () => {
    const builds = [[{ entries: [] }]];
    expect(aggregateAllowedHosts(builds, "ALLOWED")).toStrictEqual([]);
  });

  it("returns an empty array for no builds at all", () => {
    expect(aggregateAllowedHosts([], "ALLOWED")).toStrictEqual([]);
  });

  it("resolves host/port the same way as core/lib/log/parse-identifier.ts's parseIdentifier", () => {
    const builds = [
      [{ entries: [{ method: "GET", url: "http://allowed.example.com:8080/path" }] }],
    ];
    expect(aggregateAllowedHosts(builds, "ALLOWED")).toStrictEqual([
      { host: "allowed.example.com", port: "8080", ruleType: "HTTP", reason: "-", count: 1 },
    ]);
  });
});

reportResults();

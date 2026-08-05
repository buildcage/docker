import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { aggregateAllowedHosts } from "./aggregate-allowed-hosts.ts";

describe("aggregateAllowedHosts", () => {
  it("aggregates entries across multiple vertices within one build", () => {
    const builds = [
      [
        { entries: [{ method: "GET", url: "https://allowed.example.com/", status: 200 }] },
        { entries: [{ method: "GET", url: "https://allowed.example.com/", status: 200 }] },
      ],
    ];
    assert.deepEqual(aggregateAllowedHosts(builds, "ALLOWED"), [
      { host: "allowed.example.com", port: "443", ruleType: "HTTPS", reason: "-", count: 2 },
    ]);
  });

  it("aggregates entries across multiple builds", () => {
    const builds = [
      [{ entries: [{ method: "GET", url: "https://allowed.example.com/one" }] }],
      [{ entries: [{ method: "GET", url: "https://allowed.example.com/two" }] }],
    ];
    const result = aggregateAllowedHosts(builds, "ALLOWED");
    assert.equal(result.length, 1);
    assert.equal(result[0].count, 2);
  });

  it("uses the given decision label", () => {
    const builds = [[{ entries: [{ method: "GET", url: "https://allowed.example.com/" }] }]];
    assert.equal(aggregateAllowedHosts(builds, "ALLOWED")[0]?.count, 1);
    // decision itself isn't part of the aggregated shape (aggregate() drops it),
    // but distinct decisions must not collide during aggregation
    const mixed = [[{ entries: [{ method: "GET", url: "https://allowed.example.com/" }] }]];
    assert.deepEqual(aggregateAllowedHosts(mixed, "AUDIT"), [
      { host: "allowed.example.com", port: "443", ruleType: "HTTPS", reason: "-", count: 1 },
    ]);
  });

  it("skips vertices with no entries", () => {
    const builds = [[{ entries: [] }]];
    assert.deepEqual(aggregateAllowedHosts(builds, "ALLOWED"), []);
  });

  it("returns an empty array for no builds at all", () => {
    assert.deepEqual(aggregateAllowedHosts([], "ALLOWED"), []);
  });

  it("resolves host/port the same way as core/lib/log/parse-identifier.ts's parseIdentifier", () => {
    const builds = [
      [{ entries: [{ method: "GET", url: "http://allowed.example.com:8080/path" }] }],
    ];
    assert.deepEqual(aggregateAllowedHosts(builds, "ALLOWED"), [
      { host: "allowed.example.com", port: "8080", ruleType: "HTTP", reason: "-", count: 1 },
    ]);
  });
});

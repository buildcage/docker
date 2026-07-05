import { describe, it, assert, reportResults } from "./test-shim.js";
import { aggregate } from "./aggregate.js";

describe("aggregate", () => {
  it("groups entries by host:port:ruleType:reason", () => {
    const entries = [
      { host: "a.com", port: "443", ruleType: "HTTPS", reason: "r1" },
      { host: "a.com", port: "443", ruleType: "HTTPS", reason: "r1" },
      { host: "b.com", port: "80", ruleType: "HTTP", reason: "-" },
    ];
    const result = aggregate(entries);
    assert.equal(result.length, 2);
    assert.equal(result[0].host, "a.com");
    assert.equal(result[0].count, 2);
    assert.equal(result[1].host, "b.com");
    assert.equal(result[1].count, 1);
  });

  it("sorts by count descending", () => {
    const entries = [
      { host: "low.com", port: "443", ruleType: "HTTPS", reason: "r1" },
      { host: "high.com", port: "443", ruleType: "HTTPS", reason: "r1" },
      { host: "high.com", port: "443", ruleType: "HTTPS", reason: "r1" },
    ];
    const result = aggregate(entries);
    assert.equal(result[0].host, "high.com");
    assert.equal(result[0].count, 2);
    assert.equal(result[1].host, "low.com");
    assert.equal(result[1].count, 1);
  });

  it("breaks ties by host, then numeric port", () => {
    const entries = [
      { host: "b.com", port: "443", ruleType: "HTTPS", reason: "r1" },
      { host: "a.com", port: "8080", ruleType: "HTTP", reason: "r1" },
      { host: "a.com", port: "80", ruleType: "HTTP", reason: "r1" },
    ];
    const result = aggregate(entries);
    assert.deepEqual(
      result.map((e) => `${e.host}:${e.port}`),
      ["a.com:80", "a.com:8080", "b.com:443"],
    );
  });

  it("empty input returns empty array", () => {
    assert.deepEqual(aggregate([]), []);
  });
});

reportResults();

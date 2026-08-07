import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import { aggregate } from "./aggregate.ts";

describe("aggregate", () => {
  it("groups entries by host:port:ruleType:reason", () => {
    const entries = [
      { host: "a.com", port: "443", ruleType: "HTTPS", reason: "r1" },
      { host: "a.com", port: "443", ruleType: "HTTPS", reason: "r1" },
      { host: "b.com", port: "80", ruleType: "HTTP", reason: "-" },
    ];
    const result = aggregate(entries);
    expect(result.length).toBe(2);
    expect(result[0].host).toBe("a.com");
    expect(result[0].count).toBe(2);
    expect(result[1].host).toBe("b.com");
    expect(result[1].count).toBe(1);
  });

  it("sorts by count descending", () => {
    const entries = [
      { host: "low.com", port: "443", ruleType: "HTTPS", reason: "r1" },
      { host: "high.com", port: "443", ruleType: "HTTPS", reason: "r1" },
      { host: "high.com", port: "443", ruleType: "HTTPS", reason: "r1" },
    ];
    const result = aggregate(entries);
    expect(result[0].host).toBe("high.com");
    expect(result[0].count).toBe(2);
    expect(result[1].host).toBe("low.com");
    expect(result[1].count).toBe(1);
  });

  it("breaks ties by host, then numeric port", () => {
    const entries = [
      { host: "b.com", port: "443", ruleType: "HTTPS", reason: "r1" },
      { host: "a.com", port: "8080", ruleType: "HTTP", reason: "r1" },
      { host: "a.com", port: "80", ruleType: "HTTP", reason: "r1" },
    ];
    const result = aggregate(entries);
    expect(result.map((e) => `${e.host}:${e.port}`)).toStrictEqual([
      "a.com:80",
      "a.com:8080",
      "b.com:443",
    ]);
  });

  it("empty input returns empty array", () => {
    expect(aggregate([])).toStrictEqual([]);
  });
});

reportResults();

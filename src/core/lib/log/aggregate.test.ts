import { describe, it, expect } from "vitest";

import { aggregate, createIncrementalAggregator, type LogEntry } from "./aggregate.ts";

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

describe("createIncrementalAggregator", () => {
  const fold = (entries: LogEntry[]) => {
    const agg = createIncrementalAggregator();
    for (const e of entries) agg.add(e);
    return agg.toSortedArray();
  };

  it("folds entries sharing host:port:ruleType:reason into one counted row", () => {
    expect(
      fold([
        { host: "a.com", port: "443", ruleType: "HTTPS", reason: "r1" },
        { host: "a.com", port: "443", ruleType: "HTTPS", reason: "r1" },
        { host: "a.com", port: "443", ruleType: "HTTPS", reason: "r2" },
      ]),
    ).toStrictEqual([
      { host: "a.com", port: "443", ruleType: "HTTPS", reason: "r1", count: 2 },
      { host: "a.com", port: "443", ruleType: "HTTPS", reason: "r2", count: 1 },
    ]);
  });

  it("returns an empty array when nothing was added", () => {
    expect(fold([])).toStrictEqual([]);
  });

  // The two share compareAggregated precisely so a report reads the same
  // whether its log was scanned in one pass or streamed.
  it("returns what aggregate() returns for the same entries, tie-breaks included", () => {
    const entries: LogEntry[] = [
      { host: "b.com", port: "443", ruleType: "HTTPS", reason: "r1" },
      { host: "a.com", port: "8080", ruleType: "HTTP", reason: "r1" },
      { host: "a.com", port: "80", ruleType: "HTTP", reason: "r1" },
      { host: "b.com", port: "443", ruleType: "HTTPS", reason: "r1" },
      { host: "c.com", port: "443", ruleType: "HTTPS", reason: "r1" },
    ];
    expect(fold(entries)).toStrictEqual(aggregate(entries));
  });
});

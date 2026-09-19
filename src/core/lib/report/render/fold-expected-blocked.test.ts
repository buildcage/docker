import { describe, it, expect } from "vitest";
import { foldExpectedBlockedRows } from "./fold-expected-blocked.ts";
import type { HostTableRow } from "./host-table.ts";

describe("foldExpectedBlockedRows", () => {
  const row = (overrides: Partial<HostTableRow> = {}): HostTableRow => ({
    host: "a.sury.org",
    port: "-",
    ruleType: "DNS",
    reason: "dns-not-allowed",
    count: 1,
    expected: true,
    expectedBy: "*.sury.org:*",
    ...overrides,
  });

  it("folds the rows one rule matched into a single row", () => {
    const folded = foldExpectedBlockedRows([
      row({ host: "a.sury.org", count: 2 }),
      row({ host: "b.sury.org", count: 3 }),
    ]);
    expect(folded.length).toBe(1);
    expect(folded[0].display).toBe("*.sury.org:* (2 hosts)");
    expect(folded[0].count).toBe(5);
    expect(folded[0].expected).toBe(true);
  });

  it("keeps the rule type and reason of the rows it folded", () => {
    const folded = foldExpectedBlockedRows([row(), row({ host: "b.sury.org" })]);
    expect(folded[0].ruleType).toBe("DNS");
    expect(folded[0].reason).toBe("dns-not-allowed");
  });

  it("says host, not hosts, when the rule matched only one", () => {
    expect(foldExpectedBlockedRows([row()])[0].display).toBe("*.sury.org:* (1 host)");
  });

  it("counts one host blocked on two ports once", () => {
    const folded = foldExpectedBlockedRows([
      row({ port: "443", ruleType: "HTTPS", reason: "https-not-allowed" }),
      row({ port: "8443", ruleType: "HTTPS", reason: "https-not-allowed" }),
    ]);
    expect(folded[0].display).toBe("*.sury.org:* (1 host)");
    expect(folded[0].count).toBe(2);
  });

  it("splits one rule's rows by rule type and reason", () => {
    const folded = foldExpectedBlockedRows([
      row(),
      row({ host: "b.sury.org", port: "443", ruleType: "HTTPS", reason: "https-not-allowed" }),
    ]);
    expect(folded.length).toBe(2);
    expect(folded.map((r) => r.ruleType).sort()).toStrictEqual(["DNS", "HTTPS"]);
  });

  it("keeps a row no rule matched as it is, ahead of the folded ones", () => {
    const unmatched = row({ host: "evil.example.com", expected: false, expectedBy: undefined });
    const folded = foldExpectedBlockedRows([row(), unmatched]);
    expect(folded[0]).toStrictEqual(unmatched);
    expect(folded[1].display).toBe("*.sury.org:* (1 host)");
  });

  it("preserves the order of the rows no rule matched", () => {
    const first = row({
      host: "first.example.com",
      count: 9,
      expected: false,
      expectedBy: undefined,
    });
    const second = row({
      host: "second.example.com",
      count: 4,
      expected: false,
      expectedBy: undefined,
    });
    const folded = foldExpectedBlockedRows([first, second]);
    expect(folded.map((r) => r.host)).toStrictEqual(["first.example.com", "second.example.com"]);
  });

  it("orders folded rows by total count, then by rule", () => {
    const folded = foldExpectedBlockedRows([
      row({ expectedBy: "*.quiet.example:*", count: 1 }),
      row({ expectedBy: "*.sury.org:*", count: 4 }),
      row({ expectedBy: "*.noisy.example:*", count: 1 }),
    ]);
    expect(folded.map((r) => r.expectedBy)).toStrictEqual([
      "*.sury.org:*",
      "*.noisy.example:*",
      "*.quiet.example:*",
    ]);
  });

  it("returns nothing for no rows", () => {
    expect(foldExpectedBlockedRows([])).toStrictEqual([]);
  });
});

describe("foldExpectedBlockedRows: grouping key and tie-break", () => {
  const anyRow = (overrides: Partial<HostTableRow> = {}): HostTableRow => ({
    host: "a.example.com",
    port: "-",
    ruleType: "DNS",
    reason: "dns-not-allowed",
    count: 1,
    expected: true,
    expectedBy: "*.example.com:*",
    ...overrides,
  });

  it("groups rows that carry no reason at all", () => {
    const folded = foldExpectedBlockedRows([
      anyRow({ host: "a.example.com", reason: undefined }),
      anyRow({ host: "b.example.com", reason: undefined }),
    ]);
    expect(folded.length).toBe(1);
    expect(folded[0].count).toBe(2);
  });

  // Equal counts fall through to the rule text, so the order does not depend on
  // which row the proxy happened to log first.
  it("breaks a tie on count by rule text", () => {
    const folded = foldExpectedBlockedRows([
      anyRow({ host: "z.example.com", expectedBy: "z.example.com:*" }),
      anyRow({ host: "a.example.com", expectedBy: "a.example.com:*" }),
    ]);
    expect(folded.map((r) => r.display)).toStrictEqual([
      "a.example.com:* (1 host)",
      "z.example.com:* (1 host)",
    ]);
  });
});

describe("foldExpectedBlockedRows: two groups one rule produced", () => {
  // One rule can cover a refused name and a refused connection at once, which
  // is why ruleType is part of the grouping key: same rule, same count, two rows.
  it("keeps both groups when only ruleType differs", () => {
    const folded = foldExpectedBlockedRows([
      {
        host: "a.example.com",
        port: "-",
        ruleType: "DNS",
        reason: "dns-not-allowed",
        count: 1,
        expected: true,
        expectedBy: "*.example.com:*",
      },
      {
        host: "a.example.com",
        port: "443",
        ruleType: "HTTPS",
        reason: "sni-not-allowed",
        count: 1,
        expected: true,
        expectedBy: "*.example.com:*",
      },
    ]);
    expect(folded.length).toBe(2);
  });
});

describe("foldExpectedBlockedRows: a tie broken the other way", () => {
  // The tie-break has to hold whichever order the rows arrived in, so this is
  // the mirror of the case above.
  it("keeps rules in order when they already are", () => {
    const row = (expectedBy: string): HostTableRow => ({
      host: "a.example.com",
      port: "-",
      ruleType: "DNS",
      reason: "dns-not-allowed",
      count: 1,
      expected: true,
      expectedBy,
    });
    const folded = foldExpectedBlockedRows([row("a.example.com:*"), row("z.example.com:*")]);
    expect(folded.map((r) => r.display)).toStrictEqual([
      "a.example.com:* (1 host)",
      "z.example.com:* (1 host)",
    ]);
  });
});

/**
 * Unit tests for run/main.ts
 *
 * Run with: vp test run run/src/main.test.ts
 */
import { describe, it, expect } from "vitest";

import { buildACLRules, parseWritablePaths, readKnownBlockedRules } from "./main.ts";
import { InvalidRulesError } from "#core/lib/acl/rules.ts";

describe("buildACLRules", () => {
  it("parses whitespace-separated HTTPS rules", () => {
    const { httpsRules } = buildACLRules({
      httpsRulesInput: "example.com:443 *.cdn.example.com:443",
      httpRulesInput: "",
      ipRulesInput: "",
    });
    expect(httpsRules).toStrictEqual(["example.com:443", "*.cdn.example.com:443"]);
  });

  it("handles newline-separated rules", () => {
    const { httpsRules } = buildACLRules({
      httpsRulesInput: "a.com:443\nb.com:443",
      httpRulesInput: "",
      ipRulesInput: "",
    });
    expect(httpsRules).toStrictEqual(["a.com:443", "b.com:443"]);
  });

  it("returns empty arrays for empty/undefined inputs", () => {
    const result = buildACLRules({
      httpsRulesInput: "",
      httpRulesInput: undefined,
      ipRulesInput: "   ",
    });
    expect(result.httpsRules).toStrictEqual([]);
    expect(result.httpRules).toStrictEqual([]);
    expect(result.ipRules).toStrictEqual([]);
  });

  it("throws InvalidRulesError with code INVALID_RULES for invalid rule syntax", () => {
    expect.assertions(2);
    try {
      buildACLRules({
        httpsRulesInput: "no-port-specified",
        httpRulesInput: "",
        ipRulesInput: "",
      });
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidRulesError);
      expect((err as InvalidRulesError).code).toBe("INVALID_RULES");
    }
  });
});

describe("readKnownBlockedRules", () => {
  it("parses whitespace-separated rules", () => {
    expect(readKnownBlockedRules("known-bad.example.com:443 *.noisy.example.com:80")).toStrictEqual(
      ["known-bad.example.com:443", "*.noisy.example.com:80"],
    );
  });

  it("returns an empty array for empty/undefined input", () => {
    expect(readKnownBlockedRules(undefined)).toStrictEqual([]);
    expect(readKnownBlockedRules("")).toStrictEqual([]);
  });

  it("throws InvalidRulesError with code INVALID_RULES for invalid rule syntax", () => {
    expect.assertions(2);
    try {
      readKnownBlockedRules("no-port-specified");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidRulesError);
      expect((err as InvalidRulesError).code).toBe("INVALID_RULES");
    }
  });
});

describe("parseWritablePaths", () => {
  it("splits on newlines, trimming each entry", () => {
    expect(parseWritablePaths("/opt/extra\n /var/cache \n")).toStrictEqual([
      "/opt/extra",
      "/var/cache",
    ]);
  });

  it("does not split on internal spaces (paths may contain them)", () => {
    expect(parseWritablePaths("/path with spaces\n/other")).toStrictEqual([
      "/path with spaces",
      "/other",
    ]);
  });

  it("returns an empty array for empty/undefined input", () => {
    expect(parseWritablePaths("")).toStrictEqual([]);
    expect(parseWritablePaths(undefined)).toStrictEqual([]);
    expect(parseWritablePaths("   \n  \n")).toStrictEqual([]);
  });

  it("preserves a lone '/' entry (the disable-readonly sentinel)", () => {
    expect(parseWritablePaths("/")).toStrictEqual(["/"]);
  });
});

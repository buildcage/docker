import { describe, it, expect } from "vitest";

import { readRuleInputs } from "./rule-inputs.ts";

/** Stands in for core.getInput, which returns "" for anything unset. */
function inputs(values: Record<string, string> = {}): (name: string) => string {
  return (name) => values[name] ?? "";
}

describe("readRuleInputs", () => {
  it("returns empty rule lists when nothing is set", () => {
    expect(readRuleInputs(inputs())).toStrictEqual({
      httpsRules: [],
      httpRules: [],
      ipRules: [],
      urlRules: [],
      tlsRules: [],
      knownBlockedRules: [],
    });
  });

  // URL rules reach the proxy as their raw text; only it re-compiles them.
  it("parses every rule kind, URL rules as their raw text", () => {
    const parsed = readRuleInputs(
      inputs({
        allowed_https_rules: "a.example.com:443",
        allowed_http_rules: "b.example.com:80",
        allowed_ip_rules: "10.0.0.5:5432",
        allowed_tls_rules: "db.example.com:443",
        allowed_url_rules: "GET https://a.example.com/pkg.json",
        known_blocked_rules: "*.sury.org:*",
      }),
    );
    expect(parsed).toStrictEqual({
      httpsRules: ["a.example.com:443"],
      httpRules: ["b.example.com:80"],
      ipRules: ["10.0.0.5:5432"],
      urlRules: ["GET https://a.example.com/pkg.json"],
      tlsRules: ["db.example.com:443"],
      knownBlockedRules: ["*.sury.org:*"],
    });
  });

  it("rejects a malformed rule rather than passing it to the proxy", () => {
    expect(() => readRuleInputs(inputs({ allowed_https_rules: "no-port" }))).toThrow(
      expect.objectContaining({ code: "INVALID_RULES" }),
    );
  });

  // Compiled on every engine, even the one that ignores them, so a typo fails
  // here rather than silently doing nothing inside the proxy.
  it("rejects a malformed URL rule even though only inspect enforces one", () => {
    expect(() => readRuleInputs(inputs({ allowed_url_rules: "GET not-a-url" }))).toThrow(
      expect.objectContaining({ code: "INVALID_RULES" }),
    );
  });

  it("rejects a rule the parser accepts but the proxy would refuse", () => {
    expect(() => readRuleInputs(inputs({ allowed_https_rules: "10.0.0.0/8:443" }))).toThrow(
      expect.objectContaining({ code: "INVALID_RULES" }),
    );
  });
});

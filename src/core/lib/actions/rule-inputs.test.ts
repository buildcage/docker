import { describe, it, expect } from "vitest";

import { checkRuleListSizesOrThrow, readRuleInputs, type RuleInputs } from "./rule-inputs.ts";

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
        "allowed-https-rules": "a.example.com:443",
        "allowed-http-rules": "b.example.com:80",
        "allowed-ip-rules": "10.0.0.5:5432",
        "allowed-tls-rules": "db.example.com:443",
        "allowed-url-rules": "GET https://a.example.com/pkg.json",
        "known-blocked-rules": "*.sury.org:*",
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
    expect(() => readRuleInputs(inputs({ "allowed-https-rules": "no-port" }))).toThrow(
      expect.objectContaining({ code: "INVALID_RULES" }),
    );
  });

  // Compiled whatever the engine, so a typo fails here rather than silently
  // doing nothing inside the proxy.
  it("rejects a malformed URL rule even though only inspect enforces one", () => {
    expect(() => readRuleInputs(inputs({ "allowed-url-rules": "GET not-a-url" }))).toThrow(
      expect.objectContaining({ code: "INVALID_RULES" }),
    );
  });

  it("rejects a rule the parser accepts but the proxy would refuse", () => {
    expect(() => readRuleInputs(inputs({ "allowed-https-rules": "10.0.0.0/8:443" }))).toThrow(
      expect.objectContaining({ code: "INVALID_RULES" }),
    );
  });
});

describe("checkRuleListSizesOrThrow", () => {
  const empty: RuleInputs = {
    httpsRules: [],
    httpRules: [],
    ipRules: [],
    urlRules: [],
    tlsRules: [],
    knownBlockedRules: [],
  };
  // ALLOWED_HTTPS_RULES=<value> and its NUL fill 131,072 bytes at 131,051.
  const LIMIT = 131_051;
  // Rules of 10 bytes each, joined by newlines, `bytes` long in all.
  const rulesOf = (bytes: number) => {
    const rules = Array.from({ length: Math.ceil(bytes / 11) }, () => "a.test:443");
    rules[rules.length - 1] = "a".repeat(bytes - (rules.length - 1) * 11);
    return rules;
  };

  it("takes a list that fills the variable exactly", () => {
    const rules = { ...empty, httpsRules: rulesOf(LIMIT) };
    expect(rules.httpsRules.join("\n")).toHaveLength(LIMIT);
    expect(() => checkRuleListSizesOrThrow(rules, ["allowed-https-rules"])).not.toThrow();
  });

  it("refuses a list a byte over, naming the input and both sizes", () => {
    const rules = { ...empty, httpsRules: rulesOf(LIMIT + 1) };
    expect(() => checkRuleListSizesOrThrow(rules, ["allowed-https-rules"])).toThrow(
      `allowed-https-rules is ${LIMIT + 1} bytes as parsed, over the ${LIMIT} one environment variable can hold`,
    );
  });

  it("counts bytes, not characters", () => {
    const rules = { ...empty, httpsRules: ["é".repeat(Math.ceil(LIMIT / 2))] };
    expect(() => checkRuleListSizesOrThrow(rules, ["allowed-https-rules"])).toThrow("bytes");
  });

  it("checks only the inputs named, each against its own variable's name", () => {
    const rules = { ...empty, ipRules: rulesOf(LIMIT + 1), knownBlockedRules: rulesOf(LIMIT + 1) };
    expect(() => checkRuleListSizesOrThrow(rules, ["allowed-https-rules"])).not.toThrow();
    // ALLOWED_IP_RULES is three bytes shorter than ALLOWED_HTTPS_RULES.
    expect(() => checkRuleListSizesOrThrow(rules, ["allowed-ip-rules"])).not.toThrow();
    expect(() => checkRuleListSizesOrThrow(rules, ["known-blocked-rules"])).toThrow(
      "known-blocked-rules is",
    );
  });
});

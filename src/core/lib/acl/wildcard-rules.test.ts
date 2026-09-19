import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import {
  wildcardToRegex,
  convertRule,
  buildRules,
  parseAndValidateRules,
  completeRulePort,
  parseAndValidateKnownBlockedRules,
} from "./wildcard-rules.ts";

// ---------------------------------------------------------------------------
// wildcardToRegex
// ---------------------------------------------------------------------------
describe("wildcardToRegex", () => {
  it("exact domain: dots escaped", () => {
    expect(wildcardToRegex("example.com:443")).toBe("example\\.com:443");
  });

  it("single wildcard *", () => {
    expect(wildcardToRegex("*.example.com:443")).toBe("[^.]+\\.example\\.com:443");
  });

  it("double wildcard **", () => {
    expect(wildcardToRegex("**.example.com:443")).toBe(".+\\.example\\.com:443");
  });

  it("question mark ?", () => {
    expect(wildcardToRegex("exampl?.com:443")).toBe("exampl[^.]\\.com:443");
  });

  it("multiple wildcards", () => {
    expect(wildcardToRegex("*.*.example.com:443")).toBe("[^.]+\\.[^.]+\\.example\\.com:443");
  });

  it("rejects mixed * in part", () => {
    expect(() => wildcardToRegex("w*.example.com:443")).toThrow(/Invalid wildcard/);
  });

  it("escapes regex meta characters in domain", () => {
    expect(wildcardToRegex("example+site.com:443")).toBe("example\\+site\\.com:443");
  });

  it("wildcard port *", () => {
    expect(wildcardToRegex("example.com:*")).toBe("example\\.com:\\d+");
  });

  it("rejects a port that is missing, non-numeric or not the last colon", () => {
    expect(() => wildcardToRegex("example.com")).toThrow(/Invalid pattern/);
    expect(() => wildcardToRegex("example.com:abc")).toThrow(/Invalid pattern/);
    expect(() => wildcardToRegex("example.com:443:extra")).toThrow(/Invalid pattern/);
  });
});

// ---------------------------------------------------------------------------
// convertRule
// ---------------------------------------------------------------------------
describe("convertRule", () => {
  it("wraps the wildcard conversion in anchors", () => {
    expect(convertRule("*.example.com:8443")).toBe("^[^.]+\\.example\\.com:8443$");
  });

  it("regex rule (~ prefix): returned as-is without ~", () => {
    expect(convertRule("~^custom\\.regex:443$")).toBe("^custom\\.regex:443$");
  });

  it("anchors a regex rule the author left open at either end", () => {
    expect(convertRule("~example\\.com:443")).toBe("^example\\.com:443$");
    expect(convertRule("~^example\\.com:443")).toBe("^example\\.com:443$");
    expect(convertRule("~example\\.com:443$")).toBe("^example\\.com:443$");
  });

  it("refuses a top-level alternation, which anchors cannot bind around", () => {
    expect(() => convertRule("~a\\.com:443|b\\.com:443")).toThrow(/top-level "\|"/);
    expect(() => convertRule("~a\\.com|b\\.com:443")).toThrow(/top-level "\|"/);
  });

  it("refuses an IPv6 authority, whose colons are not the port separator", () => {
    expect(() => convertRule("~^\\[::1\\]:443$")).toThrow(/IPv6/);
  });

  it("leaves an alternation inside a group or a class alone", () => {
    expect(convertRule("~a\\.com:(443|8443)")).toBe("^a\\.com:(443|8443)$");
    expect(convertRule("~a\\.com:[4|8]443")).toBe("^a\\.com:[4|8]443$");
  });

  it("treats an escaped dollar as a literal, not as the anchor it looks like", () => {
    expect(convertRule("~a\\.com:443\\$")).toBe("^a\\.com:443\\$$");
    // An escaped backslash before the "$" leaves the "$" itself an anchor.
    expect(convertRule("~a\\.com:443\\\\$")).toBe("^a\\.com:443\\\\$");
  });

  it("rejects invalid regex (~ prefix)", () => {
    expect(() => convertRule("~^(unclosed")).toThrow(/Invalid regex/);
  });

  it("rejects a regex rule (~ prefix) with no port", () => {
    expect(() => convertRule("~^example\\.com$")).toThrow(/a port is always required/);
  });

  it("rejects a regex rule (~ prefix) with no port even without anchors", () => {
    expect(() => convertRule("~example\\.com")).toThrow(/a port is always required/);
  });
});

// ---------------------------------------------------------------------------
// convertRule: regex behavior (match / non-match)
// ---------------------------------------------------------------------------
describe("convertRule: regex behavior", () => {
  it("* matches single-level subdomain only", () => {
    const re = new RegExp(convertRule("*.example.com:443"));
    expect(re.test("sub.example.com:443")).toBeTruthy();
    expect(!re.test("deep.sub.example.com:443")).toBeTruthy();
    expect(!re.test("example.com:443")).toBeTruthy();
  });

  it("** matches multi-level subdomains", () => {
    const re = new RegExp(convertRule("**.example.com:443"));
    expect(re.test("sub.example.com:443")).toBeTruthy();
    expect(re.test("deep.sub.example.com:443")).toBeTruthy();
    expect(!re.test("example.com:443")).toBeTruthy();
  });

  it("? matches exactly one non-dot character", () => {
    const re = new RegExp(convertRule("exampl?.com:443"));
    expect(re.test("example.com:443")).toBeTruthy();
    expect(!re.test("exampl.com:443")).toBeTruthy();
    expect(!re.test("examplee.com:443")).toBeTruthy();
  });

  it("exact domain does not match subdomains", () => {
    const re = new RegExp(convertRule("example.com:443"));
    expect(re.test("example.com:443")).toBeTruthy();
    expect(!re.test("sub.example.com:443")).toBeTruthy();
  });

  it("port mismatch is rejected", () => {
    const re = new RegExp(convertRule("example.com:443"));
    expect(!re.test("example.com:8443")).toBeTruthy();
  });

  it("wildcard port matches any port", () => {
    const re = new RegExp(convertRule("example.com:*"));
    expect(re.test("example.com:443")).toBeTruthy();
    expect(re.test("example.com:8080")).toBeTruthy();
    expect(!re.test("example.com:abc")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// buildRules
// ---------------------------------------------------------------------------
describe("buildRules", () => {
  it("converts multiple rules", () => {
    expect(buildRules("example.com:443 *.foo.com:8443")).toStrictEqual([
      "^example\\.com:443$",
      "^[^.]+\\.foo\\.com:8443$",
    ]);
  });

  it("empty input → empty array", () => {
    expect(buildRules("")).toStrictEqual([]);
  });

  it("regex rules (~ prefix)", () => {
    expect(buildRules("~^custom\\.regex:(443|8080)$ example.com:443")).toStrictEqual([
      "^custom\\.regex:(443|8080)$",
      "^example\\.com:443$",
    ]);
  });
});

// ---------------------------------------------------------------------------
// parseAndValidateRules
// ---------------------------------------------------------------------------
describe("parseAndValidateRules", () => {
  it("returns raw (unconverted) rule tokens", () => {
    expect(parseAndValidateRules("example.com:443 *.foo.com:8443")).toStrictEqual([
      "example.com:443",
      "*.foo.com:8443",
    ]);
    // A YAML block scalar hands the action newlines rather than spaces.
    expect(parseAndValidateRules("example.com:443\n*.foo.com:8443")).toStrictEqual([
      "example.com:443",
      "*.foo.com:8443",
    ]);
  });

  it("validates syntax eagerly, throwing on invalid wildcard rules", () => {
    expect(() => parseAndValidateRules("w*.example.com:443")).toThrow(/Invalid wildcard/);
  });

  it("validates syntax eagerly, throwing on invalid regex rules", () => {
    expect(() => parseAndValidateRules("~^(unclosed")).toThrow(/Invalid regex/);
  });
});

describe("known_blocked_rules port completion", () => {
  it("completes a rule that names no port, so a refused name can be declared", () => {
    // A refused name has no port at all: nothing was connected to. Requiring
    // one would mean writing a port that was never involved.
    expect(completeRulePort("_mongodb._tcp.c0.example.net")).toBe("_mongodb._tcp.c0.example.net:*");
    expect(completeRulePort("telemetry.example.com")).toBe("telemetry.example.com:*");
    expect(completeRulePort("*.example.com")).toBe("*.example.com:*");
  });

  it("leaves a rule that already names a port alone", () => {
    expect(completeRulePort("noisy.example.com:443")).toBe("noisy.example.com:443");
    expect(completeRulePort("noisy.example.com:*")).toBe("noisy.example.com:*");
    expect(completeRulePort("~^a[.]example[.]com:443$")).toBe("~^a[.]example[.]com:443$");
  });

  it("takes a regex rule's closing anchor off, convertRule putting it back", () => {
    // Appended after the `$` the port would match nothing.
    expect(completeRulePort("~^_mongodb[.]_tcp[.]c0$")).toBe("~^_mongodb[.]_tcp[.]c0:\\d+");
    expect(convertRule(completeRulePort("~^_mongodb[.]_tcp[.]c0$"))).toBe(
      "^_mongodb[.]_tcp[.]c0:\\d+$",
    );
  });

  it("keeps an escaped dollar, which is a literal rather than an anchor", () => {
    expect(completeRulePort("~^a\\$")).toBe("~^a\\$:\\d+");
  });

  it("is what parseAndValidateKnownBlockedRules returns", () => {
    expect(parseAndValidateKnownBlockedRules("a.example.com b.example.com:443")).toStrictEqual([
      "a.example.com:*",
      "b.example.com:443",
    ]);
  });

  it("still rejects a rule that is malformed for other reasons", () => {
    expect(() => parseAndValidateKnownBlockedRules("a*b.example.com")).toThrow();
  });

  it("does not apply to the other rule inputs, which name a real connection", () => {
    expect(() => parseAndValidateRules("a.example.com")).toThrow();
  });
});

reportResults();

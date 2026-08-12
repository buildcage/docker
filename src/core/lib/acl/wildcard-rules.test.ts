import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import {
  wildcardToRegex,
  convertRule,
  buildRules,
  parseAndValidateRules,
} from "./wildcard-rules.ts";

// ---------------------------------------------------------------------------
// wildcardToRegex
// ---------------------------------------------------------------------------
describe("wildcardToRegex", () => {
  it("exact domain — dots escaped", () => {
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

  it("rejects mixed ** in part", () => {
    expect(() => wildcardToRegex("w**.example.com:443")).toThrow(/Invalid wildcard/);
  });

  it("escapes regex meta characters in domain", () => {
    expect(wildcardToRegex("example+site.com:443")).toBe("example\\+site\\.com:443");
  });

  it("wildcard port *", () => {
    expect(wildcardToRegex("example.com:*")).toBe("example\\.com:\\d+");
  });

  it("rejects missing port", () => {
    expect(() => wildcardToRegex("example.com")).toThrow(/Invalid pattern/);
  });

  it("rejects non-numeric port", () => {
    expect(() => wildcardToRegex("example.com:abc")).toThrow(/Invalid pattern/);
  });

  it("rejects multiple colons", () => {
    expect(() => wildcardToRegex("example.com:443:extra")).toThrow(/Invalid pattern/);
  });
});

// ---------------------------------------------------------------------------
// convertRule
// ---------------------------------------------------------------------------
describe("convertRule", () => {
  it("domain with explicit port", () => {
    expect(convertRule("example.com:8443")).toBe("^example\\.com:8443$");
  });

  it("wildcard with explicit port", () => {
    expect(convertRule("*.example.com:8443")).toBe("^[^.]+\\.example\\.com:8443$");
  });

  it("** wildcard with explicit port", () => {
    expect(convertRule("**.example.com:443")).toBe("^.+\\.example\\.com:443$");
  });

  it("regex rule (~ prefix) — returned as-is without ~", () => {
    expect(convertRule("~^custom\\.regex:443$")).toBe("^custom\\.regex:443$");
  });

  it("rejects invalid regex (~ prefix)", () => {
    expect(() => convertRule("~^(unclosed")).toThrow(/Invalid regex/);
  });
});

// ---------------------------------------------------------------------------
// convertRule — regex behavior (match / non-match)
// ---------------------------------------------------------------------------
describe("convertRule — regex behavior", () => {
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
  });

  it("empty input → empty array", () => {
    expect(parseAndValidateRules("")).toStrictEqual([]);
  });

  it("validates syntax eagerly, throwing on invalid wildcard rules", () => {
    expect(() => parseAndValidateRules("w*.example.com:443")).toThrow(/Invalid wildcard/);
  });

  it("validates syntax eagerly, throwing on invalid regex rules", () => {
    expect(() => parseAndValidateRules("~^(unclosed")).toThrow(/Invalid regex/);
  });
});

reportResults();

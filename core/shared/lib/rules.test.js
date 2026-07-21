import { describe, it, assert, reportResults } from "../test/test-shim.js";
import {
  wildcardToRegex,
  convertRule,
  buildRules,
  parseAndValidateRules,
} from "./rules.js";

// ---------------------------------------------------------------------------
// wildcardToRegex
// ---------------------------------------------------------------------------
describe("wildcardToRegex", () => {
  it("exact domain — dots escaped", () => {
    assert.equal(wildcardToRegex("example.com:443"), "example\\.com:443");
  });

  it("single wildcard *", () => {
    assert.equal(wildcardToRegex("*.example.com:443"), "[^.]+\\.example\\.com:443");
  });

  it("double wildcard **", () => {
    assert.equal(wildcardToRegex("**.example.com:443"), ".+\\.example\\.com:443");
  });

  it("question mark ?", () => {
    assert.equal(wildcardToRegex("exampl?.com:443"), "exampl[^.]\\.com:443");
  });

  it("multiple wildcards", () => {
    assert.equal(
      wildcardToRegex("*.*.example.com:443"),
      "[^.]+\\.[^.]+\\.example\\.com:443",
    );
  });

  it("rejects mixed * in part", () => {
    assert.throws(() => wildcardToRegex("w*.example.com:443"), /Invalid wildcard/);
  });

  it("rejects mixed ** in part", () => {
    assert.throws(() => wildcardToRegex("w**.example.com:443"), /Invalid wildcard/);
  });

  it("escapes regex meta characters in domain", () => {
    assert.equal(wildcardToRegex("example+site.com:443"), "example\\+site\\.com:443");
  });

  it("wildcard port *", () => {
    assert.equal(wildcardToRegex("example.com:*"), "example\\.com:\\d+");
  });

  it("rejects missing port", () => {
    assert.throws(() => wildcardToRegex("example.com"), /Invalid pattern/);
  });

  it("rejects non-numeric port", () => {
    assert.throws(() => wildcardToRegex("example.com:abc"), /Invalid pattern/);
  });

  it("rejects multiple colons", () => {
    assert.throws(() => wildcardToRegex("example.com:443:extra"), /Invalid pattern/);
  });
});

// ---------------------------------------------------------------------------
// convertRule
// ---------------------------------------------------------------------------
describe("convertRule", () => {
  it("domain with explicit port", () => {
    assert.equal(convertRule("example.com:8443"), "^example\\.com:8443$");
  });

  it("wildcard with explicit port", () => {
    assert.equal(
      convertRule("*.example.com:8443"),
      "^[^.]+\\.example\\.com:8443$",
    );
  });

  it("** wildcard with explicit port", () => {
    assert.equal(
      convertRule("**.example.com:443"),
      "^.+\\.example\\.com:443$",
    );
  });

  it("regex rule (~ prefix) — returned as-is without ~", () => {
    assert.equal(
      convertRule("~^custom\\.regex:443$"),
      "^custom\\.regex:443$",
    );
  });

  it("rejects invalid regex (~ prefix)", () => {
    assert.throws(() => convertRule("~^(unclosed"), /Invalid regex/);
  });
});

// ---------------------------------------------------------------------------
// convertRule — regex behavior (match / non-match)
// ---------------------------------------------------------------------------
describe("convertRule — regex behavior", () => {
  it("* matches single-level subdomain only", () => {
    const re = new RegExp(convertRule("*.example.com:443"));
    assert.ok(re.test("sub.example.com:443"));
    assert.ok(!re.test("deep.sub.example.com:443"));
    assert.ok(!re.test("example.com:443"));
  });

  it("** matches multi-level subdomains", () => {
    const re = new RegExp(convertRule("**.example.com:443"));
    assert.ok(re.test("sub.example.com:443"));
    assert.ok(re.test("deep.sub.example.com:443"));
    assert.ok(!re.test("example.com:443"));
  });

  it("? matches exactly one non-dot character", () => {
    const re = new RegExp(convertRule("exampl?.com:443"));
    assert.ok(re.test("example.com:443"));
    assert.ok(!re.test("exampl.com:443"));
    assert.ok(!re.test("examplee.com:443"));
  });

  it("exact domain does not match subdomains", () => {
    const re = new RegExp(convertRule("example.com:443"));
    assert.ok(re.test("example.com:443"));
    assert.ok(!re.test("sub.example.com:443"));
  });

  it("port mismatch is rejected", () => {
    const re = new RegExp(convertRule("example.com:443"));
    assert.ok(!re.test("example.com:8443"));
  });

  it("wildcard port matches any port", () => {
    const re = new RegExp(convertRule("example.com:*"));
    assert.ok(re.test("example.com:443"));
    assert.ok(re.test("example.com:8080"));
    assert.ok(!re.test("example.com:abc"));
  });
});

// ---------------------------------------------------------------------------
// buildRules
// ---------------------------------------------------------------------------
describe("buildRules", () => {
  it("converts multiple rules", () => {
    assert.deepEqual(
      buildRules("example.com:443 *.foo.com:8443"),
      ["^example\\.com:443$", "^[^.]+\\.foo\\.com:8443$"],
    );
  });

  it("empty input → empty array", () => {
    assert.deepEqual(buildRules(""), []);
  });

  it("regex rules (~ prefix)", () => {
    assert.deepEqual(
      buildRules("~^custom\\.regex:(443|8080)$ example.com:443"),
      ["^custom\\.regex:(443|8080)$", "^example\\.com:443$"],
    );
  });
});

// ---------------------------------------------------------------------------
// parseAndValidateRules
// ---------------------------------------------------------------------------
describe("parseAndValidateRules", () => {
  it("returns raw (unconverted) rule tokens", () => {
    assert.deepEqual(
      parseAndValidateRules("example.com:443 *.foo.com:8443"),
      ["example.com:443", "*.foo.com:8443"],
    );
  });

  it("empty input → empty array", () => {
    assert.deepEqual(parseAndValidateRules(""), []);
  });

  it("validates syntax eagerly, throwing on invalid wildcard rules", () => {
    assert.throws(() => parseAndValidateRules("w*.example.com:443"), /Invalid wildcard/);
  });

  it("validates syntax eagerly, throwing on invalid regex rules", () => {
    assert.throws(() => parseAndValidateRules("~^(unclosed"), /Invalid regex/);
  });
});

reportResults();

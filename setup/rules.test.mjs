import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  splitRules,
  wildcardToRegex,
  convertRule,
  isIPRule,
  convertLegacyDomains,
  buildRules,
  buildLegacyRules,
} from "./rules.mjs";

// ---------------------------------------------------------------------------
// splitRules
// ---------------------------------------------------------------------------
describe("splitRules", () => {
  it("splits on whitespace", () => {
    assert.deepEqual(splitRules("a.com:443 b.com:443\tc.com:443"), ["a.com:443", "b.com:443", "c.com:443"]);
  });

  it("splits on newlines", () => {
    assert.deepEqual(splitRules("a.com:443\nb.com:443\n"), ["a.com:443", "b.com:443"]);
  });

  it("commas are NOT delimiters", () => {
    assert.deepEqual(splitRules("a.com:443,b.com:443"), ["a.com:443,b.com:443"]);
  });

  it("preserves commas and whitespace inside {}", () => {
    assert.deepEqual(
      splitRules("~^a\\.com:{80, 8080}$ b.com:443"),
      ["~^a\\.com:{80, 8080}$", "b.com:443"],
    );
  });

  it("returns empty array for empty input", () => {
    assert.deepEqual(splitRules(""), []);
  });

  it("returns empty array for whitespace-only input", () => {
    assert.deepEqual(splitRules("   "), []);
  });
});

// ---------------------------------------------------------------------------
// wildcardToRegex
// ---------------------------------------------------------------------------
describe("wildcardToRegex", () => {
  it("exact domain — dots escaped", () => {
    assert.equal(wildcardToRegex("example.com"), "example\\.com");
  });

  it("single wildcard *", () => {
    assert.equal(wildcardToRegex("*.example.com"), "[^.]+\\.example\\.com");
  });

  it("double wildcard **", () => {
    assert.equal(wildcardToRegex("**.example.com"), ".+\\.example\\.com");
  });

  it("question mark ?", () => {
    assert.equal(wildcardToRegex("exampl?.com"), "exampl[^.]\\.com");
  });

  it("multiple wildcards", () => {
    assert.equal(
      wildcardToRegex("*.*.example.com"),
      "[^.]+\\.[^.]+\\.example\\.com",
    );
  });

  it("rejects mixed * in part", () => {
    assert.throws(() => wildcardToRegex("w*.example.com"), /Invalid wildcard/);
  });

  it("rejects mixed ** in part", () => {
    assert.throws(() => wildcardToRegex("w**.example.com"), /Invalid wildcard/);
  });

  it("escapes regex meta characters in domain", () => {
    assert.equal(wildcardToRegex("example+site.com"), "example\\+site\\.com");
  });
});

// ---------------------------------------------------------------------------
// convertRule
// ---------------------------------------------------------------------------
describe("convertRule", () => {
  it("domain without port — throws error", () => {
    assert.throws(() => convertRule("example.com"), /Port is required/);
  });

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

  it("wildcard without port — throws error", () => {
    assert.throws(() => convertRule("*.example.com"), /Port is required/);
  });

  it("regex rule (~ prefix) — returned as-is without ~", () => {
    assert.equal(
      convertRule("~^custom\\.regex:443$"),
      "^custom\\.regex:443$",
    );
  });

  it("regex rule without port — returned as-is without ~", () => {
    assert.equal(
      convertRule("~^custom\\.regex$"),
      "^custom\\.regex$",
    );
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
});

// ---------------------------------------------------------------------------
// isIPRule
// ---------------------------------------------------------------------------
describe("isIPRule", () => {
  it("IPv4 with port", () => {
    assert.equal(isIPRule("192.168.1.1:443"), true);
  });

  it("IPv4 without port", () => {
    assert.equal(isIPRule("10.0.0.1"), true);
  });

  it("domain with port is not IP", () => {
    assert.equal(isIPRule("example.com:443"), false);
  });

  it("domain without port is not IP", () => {
    assert.equal(isIPRule("example.com"), false);
  });

  it("regex rule is never IP", () => {
    assert.equal(isIPRule("~^192\\.168\\.1\\.1:443$"), false);
  });

  it("wildcard is not IP", () => {
    assert.equal(isIPRule("*.example.com:443"), false);
  });

  it("partial IP is not IP", () => {
    assert.equal(isIPRule("192.168.1:443"), false);
  });
});

// ---------------------------------------------------------------------------
// convertLegacyDomains
// ---------------------------------------------------------------------------
describe("convertLegacyDomains", () => {
  it("single domain + single port", () => {
    assert.deepEqual(
      convertLegacyDomains("example.com", "80"),
      ["^example\\.com:80$"],
    );
  });

  it("single domain + multiple ports", () => {
    assert.deepEqual(
      convertLegacyDomains("example.com", "443,8443"),
      ["^example\\.com:(443|8443)$"],
    );
  });

  it("multiple domains", () => {
    assert.deepEqual(
      convertLegacyDomains("a.com, b.com", "80"),
      ["^a\\.com:80$", "^b\\.com:80$"],
    );
  });

  it("wildcard domain + multiple ports", () => {
    assert.deepEqual(
      convertLegacyDomains("*.example.com", "443,8443"),
      ["^[^.]+\\.example\\.com:(443|8443)$"],
    );
  });
});

// ---------------------------------------------------------------------------
// buildRules
// ---------------------------------------------------------------------------
describe("buildRules", () => {
  it("new rules only", () => {
    assert.deepEqual(
      buildRules("example.com:443 *.foo.com:8443"),
      { domainRules: ["^example\\.com:443$", "^[^.]+\\.foo\\.com:8443$"], ipRules: [] },
    );
  });

  it("empty input → empty arrays", () => {
    assert.deepEqual(
      buildRules(""),
      { domainRules: [], ipRules: [] },
    );
  });

  it("IP rules are separated into ipRules", () => {
    const result = buildRules("example.com:443 192.168.1.1:443 10.0.0.1:8080");
    assert.deepEqual(result, {
      domainRules: ["^example\\.com:443$"],
      ipRules: ["^192\\.168\\.1\\.1:443$", "^10\\.0\\.0\\.1:8080$"],
    });
  });

  it("regex rules (~ prefix) are included in domainRules", () => {
    const result = buildRules("~^custom\\.regex:(443|8080)$ example.com:443");
    assert.deepEqual(result, {
      domainRules: ["^custom\\.regex:(443|8080)$", "^example\\.com:443$"],
      ipRules: [],
    });
  });
});

// ---------------------------------------------------------------------------
// buildLegacyRules
// ---------------------------------------------------------------------------
describe("buildLegacyRules", () => {
  it("converts legacy domains with deprecation warning", () => {
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (msg) => warnings.push(msg);
    try {
      const result = buildLegacyRules({
        domainsInput: "example.com",
        portsInput: "80",
        defaultPort: 80,
        protocol: "HTTP",
      });
      assert.deepEqual(result, ["^example\\.com:80$"]);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /Deprecated/i);
    } finally {
      console.warn = origWarn;
    }
  });

  it("empty input → empty array", () => {
    const result = buildLegacyRules({
      domainsInput: "",
      portsInput: "80",
      defaultPort: 80,
      protocol: "HTTP",
    });
    assert.deepEqual(result, []);
  });

  it("falls back to defaultPort when portsInput is empty", () => {
    const origWarn = console.warn;
    console.warn = () => {};
    try {
      const result = buildLegacyRules({
        domainsInput: "example.com",
        portsInput: "",
        defaultPort: 443,
        protocol: "HTTPS",
      });
      assert.deepEqual(result, ["^example\\.com:443$"]);
    } finally {
      console.warn = origWarn;
    }
  });
});

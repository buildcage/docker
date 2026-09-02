import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import { parseMethods, convertUrlRule, buildUrlRules } from "./url-rules.ts";

// Matches how squid evaluates: the rule regex against the effective URL.
// Rules under test are method-agnostic unless the case is about methods.
function matches(urlPattern: string, url: string): boolean {
  return new RegExp(convertUrlRule(`GET ${urlPattern}`).regex).test(url);
}

// ---------------------------------------------------------------------------
// convertUrlRule — scheme, host, port
// ---------------------------------------------------------------------------
describe("convertUrlRule host and port", () => {
  it("no path matches any path on the host", () => {
    expect(matches("https://example.com", "https://example.com/")).toBe(true);
    expect(matches("https://example.com", "https://example.com/a/b")).toBe(true);
  });

  it("default port is optional in the URL", () => {
    expect(matches("https://example.com/x", "https://example.com/x")).toBe(true);
    expect(matches("https://example.com/x", "https://example.com:443/x")).toBe(true);
  });

  it("an explicit non-default port is required", () => {
    expect(matches("https://example.com:8443/x", "https://example.com:8443/x")).toBe(true);
    expect(matches("https://example.com:8443/x", "https://example.com/x")).toBe(false);
  });

  it("* port accepts any port or none", () => {
    expect(matches("https://example.com:*/x", "https://example.com:9999/x")).toBe(true);
    expect(matches("https://example.com:*/x", "https://example.com/x")).toBe(true);
  });

  it("scheme is not interchangeable", () => {
    expect(matches("https://example.com/x", "http://example.com/x")).toBe(false);
    expect(matches("http://example.com/x", "https://example.com/x")).toBe(false);
  });

  it("domain wildcards behave as in host rules", () => {
    expect(matches("https://*.example.com/x", "https://a.example.com/x")).toBe(true);
    expect(matches("https://*.example.com/x", "https://a.b.example.com/x")).toBe(false);
    expect(matches("https://**.example.com/x", "https://a.b.example.com/x")).toBe(true);
  });

  it("rejects a non-http(s) rule", () => {
    expect(() => convertUrlRule("GET ftp://example.com/x")).toThrow();
    expect(() => convertUrlRule("GET example.com/x")).toThrow();
  });

  it("rejects a bad port", () => {
    expect(() => convertUrlRule("GET https://example.com:80x/y")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// convertUrlRule — paths
// ---------------------------------------------------------------------------
describe("convertUrlRule paths", () => {
  it("* does not cross a path separator", () => {
    expect(matches("https://example.com/pkg/*", "https://example.com/pkg/a")).toBe(true);
    expect(matches("https://example.com/pkg/*", "https://example.com/pkg/a/b")).toBe(false);
  });

  it("** crosses path separators", () => {
    expect(matches("https://example.com/pkg/**", "https://example.com/pkg/a/b")).toBe(true);
  });

  it("is anchored — a longer path does not match a shorter rule", () => {
    expect(matches("https://example.com/pkg", "https://example.com/pkg/a")).toBe(false);
  });

  it("does not match a different prefix", () => {
    expect(matches("https://example.com/public/*", "https://example.com/private/x")).toBe(false);
  });

  it("is case sensitive, as paths are", () => {
    expect(matches("https://example.com/public/*", "https://example.com/PUBLIC/x")).toBe(false);
  });

  // The traversal guard lives in the generated squid.conf, not here: `*`
  // alone cannot cross a separator, but a segment that IS `..` matches it.
  it("* alone does not stop a `..` segment — hence the global guard", () => {
    expect(matches("https://example.com/pkg/*", "https://example.com/pkg/..")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ~regex escape hatch
// ---------------------------------------------------------------------------
describe("convertUrlRule regex escape hatch", () => {
  it("passes the remainder through untouched", () => {
    expect(convertUrlRule("GET ~^https://example\\.com/x$").regex).toBe(
      "^https://example\\.com/x$",
    );
  });

  it("rejects an invalid regex", () => {
    expect(() => convertUrlRule("GET ~^https://(")).toThrow();
  });

  it("splits into a host half and a path half at the first / after ://", () => {
    const r = convertUrlRule("GET ~^https://a\\.com/x$");
    expect(r.hostRegex).toBe("^a\\.com$");
    expect(r.authorityRegex).toBe("^a\\.com$");
    expect(r.pathRegex).toBe("^/x$");
    expect(r.isRegex).toBe(true);
  });

  it("recognises an escaped slash for either the scheme separator or the path start", () => {
    const r = convertUrlRule("GET ~^https:\\/\\/a\\.com\\/x$");
    expect(r.hostRegex).toBe("^a\\.com$");
    expect(r.pathRegex).toBe("^\\/x$");
  });

  it("rejects a raw regex with no scheme separator", () => {
    expect(() => convertUrlRule("GET ~^a\\.com/x$")).toThrow(/:\/\//);
  });

  it("rejects a raw regex with no path separator after ://", () => {
    expect(() => convertUrlRule("GET ~^https://a\\.com$")).toThrow(/path/);
  });

  it("keeps the host half's own port pattern for enforcement, but drops it for the resolver", () => {
    // hostRegex (matched against the connection, with and without a port --
    // see haproxy-config.ts) keeps whatever the user wrote; authorityRegex
    // (the resolver's allowlist, which has no notion of a port) never does.
    const r = convertUrlRule("GET ~^https://a\\.com:8443/x$");
    expect(r.hostRegex).toBe("^a\\.com:8443$");
    expect(r.authorityRegex).toBe("^a\\.com$");
    expect(r.pathRegex).toBe("^/x$");
  });

  it("accepts a non-literal port in the host half, unlike the other rule kinds", () => {
    // A URL rule's port is optional, so its host half is matched with and
    // without one rather than folded into a single dst_port ACL -- any
    // regex is fine there, literal or not.
    const r = convertUrlRule("GET ~^https://a\\.com:(443|8443)/x$");
    expect(r.hostRegex).toBe("^a\\.com:(443|8443)$");
    expect(r.authorityRegex).toBe("^a\\.com$");
  });
});

// ---------------------------------------------------------------------------
// buildUrlRules
// ---------------------------------------------------------------------------
describe("buildUrlRules", () => {
  it("splits on newlines and keeps the raw text", () => {
    const rules = buildUrlRules("GET https://a.com/x\n  POST https://b.com/y  \n\n");
    expect(rules.length).toBe(2);
    expect(rules[0].raw).toBe("GET https://a.com/x");
    expect(rules[1].raw).toBe("POST https://b.com/y");
  });

  it("returns an empty list for empty input", () => {
    expect(buildUrlRules(undefined).length).toBe(0);
    expect(buildUrlRules("   ").length).toBe(0);
  });

  it("drops a full-line comment, same as a blank line", () => {
    const rules = buildUrlRules(
      "# npm packages\nGET https://a.com/x\n\n  # cdn assets\nGET https://b.com/y\n",
    );
    expect(rules.map((r) => r.raw)).toStrictEqual(["GET https://a.com/x", "GET https://b.com/y"]);
  });

  it("does not treat a mid-line # as a comment marker", () => {
    const rules = buildUrlRules("GET ~^https://a\\.com/x#frag$");
    expect(rules[0].raw).toBe("GET ~^https://a\\.com/x#frag$");
  });
});

// ---------------------------------------------------------------------------
// methods
// ---------------------------------------------------------------------------
describe("methods", () => {
  it("single method is uppercased", () => {
    expect(convertUrlRule("get https://a.com/x").methods?.join(",")).toBe("GET");
  });

  it("pipe separates multiple methods", () => {
    expect(convertUrlRule("GET|POST https://a.com/x").methods?.join(",")).toBe("GET,POST");
  });

  it("comma separates multiple methods", () => {
    expect(convertUrlRule("GET,POST https://a.com/x").methods?.join(",")).toBe("GET,POST");
  });

  it("* means any method", () => {
    expect(convertUrlRule("* https://a.com/x").methods).toBe(null);
  });

  it("* wins when mixed into a list", () => {
    expect(convertUrlRule("GET|* https://a.com/x").methods).toBe(null);
  });

  it("de-duplicates", () => {
    expect(convertUrlRule("GET|get https://a.com/x").methods?.join(",")).toBe("GET");
  });

  it("accepts methods beyond the common set", () => {
    expect(convertUrlRule("PROPFIND https://a.com/x").methods?.join(",")).toBe("PROPFIND");
  });

  it("rejects a non-token method", () => {
    expect(() => parseMethods("GE T", "rule")).toThrow();
    expect(() => parseMethods("GET-1", "rule")).toThrow();
    expect(() => parseMethods("", "rule")).toThrow();
  });

  it("requires a method — a bare URL is rejected", () => {
    expect(() => convertUrlRule("https://a.com/x")).toThrow();
  });

  it("rejects a rule with a trailing extra field", () => {
    expect(() => convertUrlRule("GET https://a.com/x extra")).toThrow();
  });
});

reportResults();

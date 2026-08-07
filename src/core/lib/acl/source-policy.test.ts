import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import { buildSourcePolicy } from "./source-policy.ts";

// Simulates BuildKit's sourcepolicy engine evaluation order exactly
// (sourcepolicy/engine.go's evaluatePolicy): rules are applied in array
// order, ALLOW/DENY just flip a running "deny" flag, and the LAST matching
// rule wins. This is the real, load-bearing semantics our rule ORDER must
// produce correct results under — verified against a live buildkitd
// container (see docs/security.md).
function evaluate(
  policy: { rules: { action: string; selector: { identifier: string } }[] },
  identifier: string,
) {
  let deny = false;
  for (const rule of policy.rules) {
    if (!new RegExp(rule.selector.identifier).test(identifier)) continue;
    if (rule.action === "ALLOW") deny = false;
    if (rule.action === "DENY") deny = true;
  }
  return deny ? "DENY" : "ALLOW";
}

describe("buildSourcePolicy — rule order (last-match-wins engine semantics)", () => {
  it("puts the DENY catch-all FIRST so a later ALLOW rule overrides it", () => {
    // Regression test: the catch-all is intentionally universal (^https?://.*)
    // so it also matches every ALLOW-listed domain. Under "last match wins",
    // if DENY were listed AFTER the ALLOW rules it would always win and
    // silently deny everything.
    const policy = buildSourcePolicy({
      proxyMode: "restrict",
      httpsRulesInput: "example.com:443",
      httpRulesInput: "",
      ipRulesInput: "",
    });
    expect(policy.rules[0].action).toBe("DENY");
    expect(policy.rules[1].action).toBe("ALLOW");
  });

  it("an allowed domain evaluates to ALLOW end-to-end", () => {
    const policy = buildSourcePolicy({
      proxyMode: "restrict",
      httpsRulesInput: "example.com:443",
      httpRulesInput: "",
      ipRulesInput: "",
    });
    expect(evaluate(policy, "https://example.com/")).toBe("ALLOW");
    expect(evaluate(policy, "https://example.com:443/")).toBe("ALLOW");
  });

  it("a non-allowed domain evaluates to DENY end-to-end", () => {
    const policy = buildSourcePolicy({
      proxyMode: "restrict",
      httpsRulesInput: "example.com:443",
      httpRulesInput: "",
      ipRulesInput: "",
    });
    expect(evaluate(policy, "https://blocked.example.com/")).toBe("DENY");
  });

  it("non-http(s) sources evaluate to ALLOW (no rule ever matches them)", () => {
    const policy = buildSourcePolicy({
      proxyMode: "restrict",
      httpsRulesInput: "example.com:443",
      httpRulesInput: "",
      ipRulesInput: "",
    });
    expect(evaluate(policy, "docker-image://docker.io/library/alpine:latest")).toBe("ALLOW");
    expect(evaluate(policy, "git://github.com/foo/bar.git")).toBe("ALLOW");
  });
});

describe("buildSourcePolicy — restrict mode rule shape", () => {
  it("generates a DENY catch-all followed by an ALLOW rule per https rule", () => {
    const policy = buildSourcePolicy({
      proxyMode: "restrict",
      httpsRulesInput: "example.com:443",
      httpRulesInput: "",
      ipRulesInput: "",
    });
    expect(policy.version).toBe(1);
    expect(policy.rules).toStrictEqual([
      { action: "DENY", selector: { identifier: "^https?://.*", matchType: "REGEX" } },
      {
        action: "ALLOW",
        selector: { identifier: "^https://example\\.com(:443)?(/.*)?$", matchType: "REGEX" },
      },
    ]);
  });

  it("generates an ALLOW rule per http rule with the http scheme", () => {
    const policy = buildSourcePolicy({
      proxyMode: "restrict",
      httpsRulesInput: "",
      httpRulesInput: "deb.debian.org:80",
      ipRulesInput: "",
    });
    expect(policy.rules[1]).toStrictEqual({
      action: "ALLOW",
      selector: { identifier: "^http://deb\\.debian\\.org(:80)?(/.*)?$", matchType: "REGEX" },
    });
  });

  it("a non-default port is always required, never made optional", () => {
    const policy = buildSourcePolicy({
      proxyMode: "restrict",
      httpsRulesInput: "example.com:8443",
      httpRulesInput: "",
      ipRulesInput: "",
    });
    expect(policy.rules[1].selector.identifier).toBe("^https://example\\.com:8443(/.*)?$");
  });

  it("a wildcard port (:*) is optional too, so it also covers the implicit default port", () => {
    const policy = buildSourcePolicy({
      proxyMode: "restrict",
      httpsRulesInput: "example.com:*",
      httpRulesInput: "",
      ipRulesInput: "",
    });
    const re = new RegExp(policy.rules[1].selector.identifier);
    expect(re.test("https://example.com/")).toBeTruthy(); // no port in the URL at all
    expect(re.test("https://example.com:443/")).toBeTruthy();
    expect(re.test("https://example.com:8080/")).toBeTruthy();
  });

  it("expands each ip rule into both an https and an http ALLOW rule", () => {
    const policy = buildSourcePolicy({
      proxyMode: "restrict",
      httpsRulesInput: "",
      httpRulesInput: "",
      ipRulesInput: "192.168.1.1:443",
    });
    expect(policy.rules.slice(1, 3)).toStrictEqual([
      {
        action: "ALLOW",
        selector: { identifier: "^https://192\\.168\\.1\\.1(:443)?(/.*)?$", matchType: "REGEX" },
      },
      // :443 is not the default port for http, so it stays required
      {
        action: "ALLOW",
        selector: { identifier: "^http://192\\.168\\.1\\.1:443(/.*)?$", matchType: "REGEX" },
      },
    ]);
  });

  it("wildcard rules translate into a URL-scoped regex", () => {
    const policy = buildSourcePolicy({
      proxyMode: "restrict",
      httpsRulesInput: "*.example.com:443",
      httpRulesInput: "",
      ipRulesInput: "",
    });
    expect(policy.rules[1].selector.identifier).toBe(
      "^https://[^.]+\\.example\\.com(:443)?(/.*)?$",
    );
  });

  it("the DENY catch-all never matches non-http(s) source schemes", () => {
    const policy = buildSourcePolicy({
      proxyMode: "restrict",
      httpsRulesInput: "example.com:443",
      httpRulesInput: "",
      ipRulesInput: "",
    });
    const deny = policy.rules[0];
    expect(deny.action).toBe("DENY");
    const re = new RegExp(deny.selector.identifier);
    expect(!re.test("docker-image://docker.io/library/alpine:latest")).toBeTruthy();
    expect(!re.test("git://github.com/foo/bar.git")).toBeTruthy();
    expect(!re.test("local://context")).toBeTruthy();
    expect(!re.test("oci-layout://foo")).toBeTruthy();
    expect(re.test("https://blocked.example.com/")).toBeTruthy();
    expect(re.test("http://blocked.example.com/")).toBeTruthy();
  });

  it("the ALLOW rule matches the domain with any path, with or without an explicit default port", () => {
    const policy = buildSourcePolicy({
      proxyMode: "restrict",
      httpsRulesInput: "example.com:443",
      httpRulesInput: "",
      ipRulesInput: "",
    });
    const re = new RegExp(policy.rules[1].selector.identifier);
    expect(re.test("https://example.com/")).toBeTruthy(); // BuildKit omits :443 when the client didn't specify a port
    expect(re.test("https://example.com:443/")).toBeTruthy();
    expect(re.test("https://example.com:443/some/path?query=1")).toBeTruthy();
    expect(!re.test("https://other.com:443/")).toBeTruthy();
    expect(!re.test("https://other.com/")).toBeTruthy();
  });

  it("empty rule inputs still produce the DENY catch-all only", () => {
    const policy = buildSourcePolicy({
      proxyMode: "restrict",
      httpsRulesInput: "",
      httpRulesInput: "",
      ipRulesInput: "",
    });
    expect(policy.rules).toStrictEqual([
      { action: "DENY", selector: { identifier: "^https?://.*", matchType: "REGEX" } },
    ]);
  });
});

describe("buildSourcePolicy — regex (~) rules", () => {
  it("passes a fully-anchored regex through with just scheme + optional path added", () => {
    const policy = buildSourcePolicy({
      proxyMode: "restrict",
      httpsRulesInput: "~^custom\\.regex:443$",
      httpRulesInput: "",
      ipRulesInput: "",
    });
    expect(policy.rules[1].selector.identifier).toBe("^https://custom\\.regex:443(/.*)?$");
  });

  it("works the same way for an http rule (scheme is a parameter, not hardcoded)", () => {
    const policy = buildSourcePolicy({
      proxyMode: "restrict",
      httpsRulesInput: "",
      httpRulesInput: "~^custom\\.regex:80$",
      ipRulesInput: "",
    });
    expect(policy.rules[1].selector.identifier).toBe("^http://custom\\.regex:80(/.*)?$");
  });

  it("an anchor-less regex matches as a substring within the domain, but the missing anchors don't reach into the path", () => {
    const policy = buildSourcePolicy({
      proxyMode: "restrict",
      httpsRulesInput: "~example",
      httpRulesInput: "",
      ipRulesInput: "",
    });
    const re = new RegExp(policy.rules[1].selector.identifier);
    expect(re.test("https://example.com/")).toBeTruthy();
    expect(re.test("https://notexample.com/")).toBeTruthy(); // no leading anchor: matches anywhere
    expect(re.test("https://example.company/")).toBeTruthy(); // no trailing anchor: matches anywhere
    // ...but the domain-side [^/]* filling each missing anchor can't reach
    // past a "/" to satisfy a match that only exists in the path, unlike a
    // naive unbounded ".*" would.
    expect(!re.test("https://evil.com/example.com/")).toBeTruthy();
  });

  it("only the anchors actually present are stripped — an unanchored end still gets its own [^/]*", () => {
    const policy = buildSourcePolicy({
      proxyMode: "restrict",
      httpsRulesInput: "~^example",
      httpRulesInput: "",
      ipRulesInput: "",
    });
    const re = new RegExp(policy.rules[1].selector.identifier);
    expect(re.test("https://example.com/")).toBeTruthy(); // leading-anchored, trailing open
    expect(!re.test("https://notexample.com/")).toBeTruthy(); // leading anchor still enforced
  });

  it("the user's own \".*\" is confined to the domain (converted to [^/]*), so it can't cross into the path", () => {
    const policy = buildSourcePolicy({
      proxyMode: "restrict",
      httpsRulesInput: "~^.*\\.example\\.com:443$",
      httpRulesInput: "",
      ipRulesInput: "",
    });
    const re = new RegExp(policy.rules[1].selector.identifier);
    expect(re.test("https://sub.example.com:443/")).toBeTruthy();
    expect(!re.test("https://evil.com/sub.example.com:443/")).toBeTruthy();
  });

  it("an escaped literal trailing $ is not mistaken for the end anchor (regression)", () => {
    const policy = buildSourcePolicy({
      proxyMode: "restrict",
      httpsRulesInput: "~foo\\$",
      httpRulesInput: "",
      ipRulesInput: "",
    });
    // Previously this produced an invalid regex (a dangling "\" that escaped
    // the wrapper's own "(" — see git history for the exact failure): the
    // trailing "$" here is escaped (a literal dollar sign), not an anchor.
    const re = new RegExp(policy.rules[1].selector.identifier);
    expect(re.test("https://foo$/")).toBeTruthy();
    expect(!re.test("https://bar$/")).toBeTruthy();
  });

  it("an escaped literal '.' followed by a real '*' quantifier is left alone (not confined)", () => {
    const policy = buildSourcePolicy({
      proxyMode: "restrict",
      httpsRulesInput: "~^example\\.com:443\\.*$",
      httpRulesInput: "",
      ipRulesInput: "",
    });
    // `\.*` here means "zero or more literal dots", not the wildcard `.*` —
    // confineDotStarToDomain must not touch it.
    const re = new RegExp(policy.rules[1].selector.identifier);
    expect(re.test("https://example.com:443/")).toBeTruthy();
    expect(re.test("https://example.com:443.../")).toBeTruthy();
  });
});

describe("buildSourcePolicy — audit mode", () => {
  it("produces no rules at all, regardless of rule inputs", () => {
    const policy = buildSourcePolicy({
      proxyMode: "audit",
      httpsRulesInput: "example.com:443",
      httpRulesInput: "deb.debian.org:80",
      ipRulesInput: "192.168.1.1:443",
    });
    expect(policy).toStrictEqual({ version: 1, rules: [] });
  });
});

reportResults();

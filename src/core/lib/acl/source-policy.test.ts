import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import { buildSourcePolicy } from "./source-policy.ts";
import type { SourcePolicyInput } from "./source-policy.ts";

// Simulates BuildKit's sourcepolicy engine evaluation order exactly
// (sourcepolicy/engine.go's evaluatePolicy): rules are applied in array
// order, ALLOW/DENY just flip a running "deny" flag, and the last matching
// rule wins. That is the load-bearing semantics the generated rule order has
// to produce correct results under, verified against a live buildkitd
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

/** Restrict mode carrying only the rule input the case is about. */
function restrict(inputs: Partial<Omit<SourcePolicyInput, "proxyMode">> = {}) {
  return buildSourcePolicy({
    proxyMode: "restrict",
    httpsRulesInput: "",
    httpRulesInput: "",
    ipRulesInput: "",
    ...inputs,
  });
}

describe("buildSourcePolicy: rule order (last-match-wins engine semantics)", () => {
  it("an allowed domain evaluates to ALLOW end-to-end", () => {
    // The catch-all is intentionally universal (^https?://.*), so it matches
    // every ALLOW-listed domain too. Under "last match wins" it has to come
    // first: listed after the ALLOW rules it would always win and deny
    // everything, which is what this case catches.
    const policy = restrict({ httpsRulesInput: "example.com:443" });
    expect(evaluate(policy, "https://example.com/")).toBe("ALLOW");
    expect(evaluate(policy, "https://example.com:443/")).toBe("ALLOW");
    expect(evaluate(policy, "https://example.com:443/some/path?query=1")).toBe("ALLOW");
  });

  it("a non-allowed domain evaluates to DENY end-to-end", () => {
    const policy = restrict({ httpsRulesInput: "example.com:443" });
    expect(evaluate(policy, "https://blocked.example.com/")).toBe("DENY");
    expect(evaluate(policy, "http://blocked.example.com/")).toBe("DENY");
  });

  it("non-http(s) sources evaluate to ALLOW (no rule ever matches them)", () => {
    const policy = restrict({ httpsRulesInput: "example.com:443" });
    expect(evaluate(policy, "docker-image://docker.io/library/alpine:latest")).toBe("ALLOW");
    expect(evaluate(policy, "git://github.com/foo/bar.git")).toBe("ALLOW");
    expect(evaluate(policy, "local://context")).toBe("ALLOW");
    expect(evaluate(policy, "oci-layout://foo")).toBe("ALLOW");
  });
});

describe("buildSourcePolicy: restrict mode rule shape", () => {
  it("generates a DENY catch-all followed by an ALLOW rule per https rule", () => {
    const policy = restrict({ httpsRulesInput: "example.com:443" });
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
    const policy = restrict({ httpRulesInput: "deb.debian.org:80" });
    expect(policy.rules[1]).toStrictEqual({
      action: "ALLOW",
      selector: { identifier: "^http://deb\\.debian\\.org(:80)?(/.*)?$", matchType: "REGEX" },
    });
  });

  it("a non-default port is always required, never made optional", () => {
    const policy = restrict({ httpsRulesInput: "example.com:8443" });
    expect(policy.rules[1].selector.identifier).toBe("^https://example\\.com:8443(/.*)?$");
  });

  it("a wildcard port (:*) is optional too, so it also covers the implicit default port", () => {
    const policy = restrict({ httpsRulesInput: "example.com:*" });
    const identifier = policy.rules[1].selector.identifier;
    expect(identifier).toBe("^https://example\\.com(:\\d+)?(/.*)?$");
    // BuildKit leaves the port out entirely when the client named none.
    expect(new RegExp(identifier).test("https://example.com/")).toBeTruthy();
  });

  it("expands each ip rule into both an https and an http ALLOW rule", () => {
    const policy = restrict({ ipRulesInput: "192.168.1.1:443" });
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
    const policy = restrict({ httpsRulesInput: "*.example.com:443" });
    expect(policy.rules[1].selector.identifier).toBe(
      "^https://[^.]+\\.example\\.com(:443)?(/.*)?$",
    );
  });

  it("empty rule inputs still produce the DENY catch-all only", () => {
    const policy = restrict();
    expect(policy.rules).toStrictEqual([
      { action: "DENY", selector: { identifier: "^https?://.*", matchType: "REGEX" } },
    ]);
  });
});

describe("buildSourcePolicy: regex (~) rules", () => {
  it("passes a fully-anchored regex through with just scheme + optional path added", () => {
    const policy = restrict({ httpsRulesInput: "~^custom\\.regex:443$" });
    expect(policy.rules[1].selector.identifier).toBe("^https://custom\\.regex:443(/.*)?$");
  });

  it("an anchor-less regex is anchored for this engine too, so it cannot widen into a neighbouring name", () => {
    // A port pattern is always required, even here.
    const policy = restrict({ httpsRulesInput: "~example\\.com(:\\d+)?" });
    const re = new RegExp(policy.rules[1].selector.identifier);
    expect(re.test("https://example.com/")).toBeTruthy();
    expect(!re.test("https://notexample.com/")).toBeTruthy();
    expect(!re.test("https://example.company/")).toBeTruthy();
    expect(!re.test("https://evil.com/example.com/")).toBeTruthy();
  });

  it("refuses a top-level alternation, so no identifier is built from one", () => {
    expect(() => restrict({ httpsRulesInput: "~a\\.com:443|b\\.com:443" })).toThrow(
      /top-level "\|"/,
    );
  });

  it("the user's own \".*\" is confined to the domain (converted to [^/]*), so it can't cross into the path", () => {
    const policy = restrict({ httpsRulesInput: "~^.*\\.example\\.com:443$" });
    const re = new RegExp(policy.rules[1].selector.identifier);
    expect(re.test("https://sub.example.com:443/")).toBeTruthy();
    expect(!re.test("https://evil.com/sub.example.com:443/")).toBeTruthy();
  });

  it("an escaped literal trailing $ is not mistaken for the end anchor (regression)", () => {
    // A port pattern is always required, even here.
    const policy = restrict({ httpsRulesInput: "~foo:443\\$" });
    // The trailing "$" here is a literal dollar sign, not an anchor: escaping
    // it as one leaves a dangling "\" that swallows the wrapper's own "(" and
    // produces an invalid regex.
    const re = new RegExp(policy.rules[1].selector.identifier);
    expect(re.test("https://foo:443$/")).toBeTruthy();
    expect(!re.test("https://bar:443$/")).toBeTruthy();
  });

  it("an escaped literal '.' followed by a real '*' quantifier is left alone (not confined)", () => {
    const policy = restrict({ httpsRulesInput: "~^example\\.com:443\\.*$" });
    // `\.*` here means "zero or more literal dots", not the wildcard `.*`, so
    // confineDotStarToDomain must not touch it.
    const re = new RegExp(policy.rules[1].selector.identifier);
    expect(re.test("https://example.com:443/")).toBeTruthy();
    expect(re.test("https://example.com:443.../")).toBeTruthy();
  });
});

describe("buildSourcePolicy: audit mode", () => {
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

import { describe, it, assert, reportResults } from "../../shared/lib/test-shim.js";
import { buildSourcePolicy } from "./source-policy.js";

// Simulates BuildKit's sourcepolicy engine evaluation order exactly
// (sourcepolicy/engine.go's evaluatePolicy): rules are applied in array
// order, ALLOW/DENY just flip a running "deny" flag, and the LAST matching
// rule wins. This is the real, load-bearing semantics our rule ORDER must
// produce correct results under — verified against a live buildkitd
// container (see docs/security.md).
function evaluate(policy, identifier) {
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
    assert.equal(policy.rules[0].action, "DENY");
    assert.equal(policy.rules[1].action, "ALLOW");
  });

  it("an allowed domain evaluates to ALLOW end-to-end", () => {
    const policy = buildSourcePolicy({
      proxyMode: "restrict",
      httpsRulesInput: "example.com:443",
      httpRulesInput: "",
      ipRulesInput: "",
    });
    assert.equal(evaluate(policy, "https://example.com/"), "ALLOW");
    assert.equal(evaluate(policy, "https://example.com:443/"), "ALLOW");
  });

  it("a non-allowed domain evaluates to DENY end-to-end", () => {
    const policy = buildSourcePolicy({
      proxyMode: "restrict",
      httpsRulesInput: "example.com:443",
      httpRulesInput: "",
      ipRulesInput: "",
    });
    assert.equal(evaluate(policy, "https://blocked.example.com/"), "DENY");
  });

  it("non-http(s) sources evaluate to ALLOW (no rule ever matches them)", () => {
    const policy = buildSourcePolicy({
      proxyMode: "restrict",
      httpsRulesInput: "example.com:443",
      httpRulesInput: "",
      ipRulesInput: "",
    });
    assert.equal(evaluate(policy, "docker-image://docker.io/library/alpine:latest"), "ALLOW");
    assert.equal(evaluate(policy, "git://github.com/foo/bar.git"), "ALLOW");
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
    assert.equal(policy.version, 1);
    assert.deepEqual(policy.rules, [
      { action: "DENY", selector: { identifier: "^https?://.*", matchType: "REGEX" } },
      { action: "ALLOW", selector: { identifier: "^https://example\\.com(:443)?(/.*)?$", matchType: "REGEX" } },
    ]);
  });

  it("generates an ALLOW rule per http rule with the http scheme", () => {
    const policy = buildSourcePolicy({
      proxyMode: "restrict",
      httpsRulesInput: "",
      httpRulesInput: "deb.debian.org:80",
      ipRulesInput: "",
    });
    assert.deepEqual(policy.rules[1], {
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
    assert.equal(policy.rules[1].selector.identifier, "^https://example\\.com:8443(/.*)?$");
  });

  it("a wildcard port (:*) is optional too, so it also covers the implicit default port", () => {
    const policy = buildSourcePolicy({
      proxyMode: "restrict",
      httpsRulesInput: "example.com:*",
      httpRulesInput: "",
      ipRulesInput: "",
    });
    const re = new RegExp(policy.rules[1].selector.identifier);
    assert.ok(re.test("https://example.com/")); // no port in the URL at all
    assert.ok(re.test("https://example.com:443/"));
    assert.ok(re.test("https://example.com:8080/"));
  });

  it("expands each ip rule into both an https and an http ALLOW rule", () => {
    const policy = buildSourcePolicy({
      proxyMode: "restrict",
      httpsRulesInput: "",
      httpRulesInput: "",
      ipRulesInput: "192.168.1.1:443",
    });
    assert.deepEqual(policy.rules.slice(1, 3), [
      { action: "ALLOW", selector: { identifier: "^https://192\\.168\\.1\\.1(:443)?(/.*)?$", matchType: "REGEX" } },
      // :443 is not the default port for http, so it stays required
      { action: "ALLOW", selector: { identifier: "^http://192\\.168\\.1\\.1:443(/.*)?$", matchType: "REGEX" } },
    ]);
  });

  it("wildcard rules translate into a URL-scoped regex", () => {
    const policy = buildSourcePolicy({
      proxyMode: "restrict",
      httpsRulesInput: "*.example.com:443",
      httpRulesInput: "",
      ipRulesInput: "",
    });
    assert.equal(policy.rules[1].selector.identifier, "^https://[^.]+\\.example\\.com(:443)?(/.*)?$");
  });

  it("the DENY catch-all never matches non-http(s) source schemes", () => {
    const policy = buildSourcePolicy({
      proxyMode: "restrict",
      httpsRulesInput: "example.com:443",
      httpRulesInput: "",
      ipRulesInput: "",
    });
    const deny = policy.rules[0];
    assert.equal(deny.action, "DENY");
    const re = new RegExp(deny.selector.identifier);
    assert.ok(!re.test("docker-image://docker.io/library/alpine:latest"));
    assert.ok(!re.test("git://github.com/foo/bar.git"));
    assert.ok(!re.test("local://context"));
    assert.ok(!re.test("oci-layout://foo"));
    assert.ok(re.test("https://blocked.example.com/"));
    assert.ok(re.test("http://blocked.example.com/"));
  });

  it("the ALLOW rule matches the domain with any path, with or without an explicit default port", () => {
    const policy = buildSourcePolicy({
      proxyMode: "restrict",
      httpsRulesInput: "example.com:443",
      httpRulesInput: "",
      ipRulesInput: "",
    });
    const re = new RegExp(policy.rules[1].selector.identifier);
    assert.ok(re.test("https://example.com/")); // BuildKit omits :443 when the client didn't specify a port
    assert.ok(re.test("https://example.com:443/"));
    assert.ok(re.test("https://example.com:443/some/path?query=1"));
    assert.ok(!re.test("https://other.com:443/"));
    assert.ok(!re.test("https://other.com/"));
  });

  it("empty rule inputs still produce the DENY catch-all only", () => {
    const policy = buildSourcePolicy({
      proxyMode: "restrict",
      httpsRulesInput: "",
      httpRulesInput: "",
      ipRulesInput: "",
    });
    assert.deepEqual(policy.rules, [
      { action: "DENY", selector: { identifier: "^https?://.*", matchType: "REGEX" } },
    ]);
  });
});

describe("buildSourcePolicy — regex (~) rules", () => {
  it("passes the user's regex through, wrapped in scheme + optional path only", () => {
    const policy = buildSourcePolicy({
      proxyMode: "restrict",
      httpsRulesInput: "~^custom\\.regex:443$",
      httpRulesInput: "",
      ipRulesInput: "",
    });
    assert.equal(policy.rules[1].selector.identifier, "^https://custom\\.regex:443(/.*)?$");
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
    assert.deepEqual(policy, { version: 1, rules: [] });
  });
});

reportResults();

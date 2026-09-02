import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import { compileRuleSet } from "./haproxy-rules.ts";
import { buildUrlRules } from "./url-rules.ts";

describe("host and url rule compilation", () => {
  it("matches the name alone and the port separately", () => {
    // The port belongs to the connection, so a header omitting a default port
    // cannot make host:9443 also permit host on 443.
    const [rule] = compileRuleSet({ httpsRules: ["a.com:9443"] }).https;
    expect(rule.hostRegex).toBe("^a\\.com$");
    expect(rule.port).toBe("9443");
  });

  it("reports any-port as null rather than a literal", () => {
    expect(compileRuleSet({ httpsRules: ["a.com:*"] }).https[0].port).toBe(null);
  });

  it("gives a host rule any path and no method", () => {
    const [rule] = compileRuleSet({ httpsRules: ["a.com:443"] }).https;
    expect(rule.pathRegex).toBe("^/");
    expect(rule.methods).toBe(null);
  });

  it("gives a url rule with no port the scheme's default, matched explicitly", () => {
    // The port still has to be matched on the connection, so a default port is
    // pinned rather than left open.
    expect(compileRuleSet({ urlRules: buildUrlRules("GET https://a.com/x") }).https[0].port).toBe(
      "443",
    );
    expect(compileRuleSet({ urlRules: buildUrlRules("GET https://a.com:*/x") }).https[0].port).toBe(
      null,
    );
  });

  it("splits url rules by scheme and carries their method and path", () => {
    const set = compileRuleSet({
      urlRules: buildUrlRules("GET https://a.com/pub/**\nPOST http://b.com/x"),
    });
    expect(set.https.length).toBe(1);
    expect(set.http.length).toBe(1);
    expect(set.https[0].pathRegex).toBe("^/pub/.*$");
    expect(set.https[0].methods?.join()).toBe("GET");
    expect(set.http[0].methods?.join()).toBe("POST");
  });

  it("ids rules per scheme, so acls never collide", () => {
    const set = compileRuleSet({ httpsRules: ["a.com:443", "b.com:443"], httpRules: ["c.com:80"] });
    expect(set.https.map((r) => r.id).join()).toBe("s0,s1");
    expect(set.http[0].id).toBe("p0");
  });

  it("splits a ~regex rule into a host and path match, with no port restriction", () => {
    const set = compileRuleSet({ urlRules: buildUrlRules("GET ~^https://a\\.com/x$") });
    expect(set.warnings.length).toBe(0);
    expect(set.https.length).toBe(1);
    expect(set.https[0].hostRegex).toBe("^a\\.com$");
    expect(set.https[0].port).toBe(null);
    expect(set.https[0].pathRegex).toBe("^/x$");
    expect(set.https[0].methods?.join()).toBe("GET");
  });

  it("carries a literal port in a ~regex rule through to a real port restriction", () => {
    const set = compileRuleSet({ urlRules: buildUrlRules("GET ~^https://a\\.com:8443/x$") });
    expect(set.https[0].hostRegex).toBe("^a\\.com$");
    expect(set.https[0].port).toBe("8443");
  });
});

describe("ip rule compilation", () => {
  it("keeps an address and its port", () => {
    const [rule] = compileRuleSet({ ipRules: ["10.0.0.5:5432"] }).ip;
    expect(rule.address).toBe("10.0.0.5");
    expect(rule.port).toBe("5432");
  });

  it("reports any-port as null", () => {
    expect(compileRuleSet({ ipRules: ["10.0.0.5:*"] }).ip[0].port).toBe(null);
  });

  it("warns and drops a rule with no port", () => {
    const set = compileRuleSet({ ipRules: ["10.0.0.5"] });
    expect(set.ip.length).toBe(0);
    expect(set.warnings[0].includes("no port")).toBe(true);
  });

  it("warns and drops a pattern, since only an address can be tunnelled", () => {
    const set = compileRuleSet({ ipRules: ["10.0.0.*:5432"] });
    expect(set.ip.length).toBe(0);
    expect(set.warnings.length).toBe(1);
  });

  it("accepts a CIDR block", () => {
    expect(compileRuleSet({ ipRules: ["10.0.0.0/24:5432"] }).ip[0].address).toBe("10.0.0.0/24");
  });

  it("passes a ~regex ip rule through instead of requiring a literal address", () => {
    const [rule] = compileRuleSet({ ipRules: ["~^192\\.168\\.1\\.\\d+$"] }).ip;
    expect(rule.address).toBe("192\\.168\\.1\\.\\d+");
    expect(rule.isRegex).toBe(true);
    expect(rule.port).toBe(null);
  });

  it("carries a literal port in a ~regex ip rule through to a real port restriction", () => {
    const [rule] = compileRuleSet({ ipRules: ["~^192\\.168\\.1\\.\\d+:8080$"] }).ip;
    expect(rule.address).toBe("192\\.168\\.1\\.\\d+");
    expect(rule.port).toBe("8080");
  });

  it("rejects a non-literal port in a ~regex ip rule", () => {
    expect(() => compileRuleSet({ ipRules: ["~^192\\.168\\.1\\.\\d+:\\d+$"] })).toThrow(
      /literal number/,
    );
  });

  it("does not treat a literal address as a regex", () => {
    expect(compileRuleSet({ ipRules: ["10.0.0.5:5432"] }).ip[0].isRegex).toBe(false);
  });
});

describe("tls rule compilation", () => {
  it("keeps the host and the port it names", () => {
    const [rule] = compileRuleSet({ tlsRules: ["db.example.com:5432"] }).tls;
    expect(rule.hostRegex).toBe("^db\\.example\\.com$");
    expect(rule.port).toBe("5432");
  });

  it("reports any-port as null", () => {
    expect(compileRuleSet({ tlsRules: ["db.example.com:*"] }).tls[0].port).toBe(null);
  });

  it("passes a ~regex host rule through instead of treating it as a wildcard", () => {
    // "." and "*" would otherwise be rewritten by domainToRegexPartial's own
    // wildcard vocabulary; a ~ rule must skip that and use the regex as-is.
    const [rule] = compileRuleSet({ tlsRules: ["~^.*\\.example\\.com$"] }).tls;
    expect(rule.hostRegex).toBe("^.*\\.example\\.com$");
    expect(rule.port).toBe(null);
  });

  it("carries a literal port in a ~regex host rule through to a real port restriction", () => {
    const [rule] = compileRuleSet({ tlsRules: ["~^example\\.com:8443$"] }).tls;
    expect(rule.hostRegex).toBe("^example\\.com$");
    expect(rule.port).toBe("8443");
  });

  it("rejects a non-literal port in a ~regex host rule", () => {
    // Neither a \d+ shorthand nor an alternation is a literal number, and
    // HAProxy's dst_port ACL cannot match either as a regex.
    expect(() => compileRuleSet({ tlsRules: ["~^example\\.com:\\d+$"] })).toThrow(/literal number/);
    expect(() => compileRuleSet({ tlsRules: ["~^example\\.com:(443|8443)$"] })).toThrow(
      /literal number/,
    );
  });
});

reportResults();

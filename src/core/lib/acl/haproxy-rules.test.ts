import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import { compileRuleSet } from "./haproxy-rules.ts";
import { buildUrlRules } from "./url-rules.ts";

describe("host and url rule compilation", () => {
  it("matches the name alone and the port separately", () => {
    // The port belongs to the connection, so a header omitting a default port
    // cannot make host:9443 also permit host on 443.
    const [rule] = compileRuleSet({ httpsRules: ["a.com:9443"] }).https;
    expect(rule.hostMatch).toBe("wildcard");
    expect(rule.hostRegex).toBe("^a\\.com$");
    expect(rule.port).toBe("9443");
  });

  it("reports any-port as null rather than a literal", () => {
    expect(compileRuleSet({ httpsRules: ["a.com:*"] }).https[0].port).toBe(null);
  });

  it("rejects a host rule with no port at all", () => {
    expect(() => compileRuleSet({ httpsRules: ["a.com"] })).toThrow(/missing port/);
    expect(() => compileRuleSet({ httpRules: ["a.com"] })).toThrow(/missing port/);
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

  it("gives a ~regex url rule's host half bare/full matching, with no port acl", () => {
    const set = compileRuleSet({ urlRules: buildUrlRules("GET ~^https://a\\.com/x$") });
    expect(set.warnings.length).toBe(0);
    expect(set.https.length).toBe(1);
    expect(set.https[0].hostMatch).toBe("hostBareFull");
    expect(set.https[0].hostRegex).toBe("^a\\.com$");
    expect(set.https[0].port).toBe(null);
    expect(set.https[0].pathRegex).toBe("^/x$");
    expect(set.https[0].methods?.join()).toBe("GET");
  });

  it("keeps a ~regex url rule's own port pattern in the host half untouched", () => {
    // No literal-only restriction any more: the whole host half, port
    // pattern included, is matched as one expression -- see haproxy-config.ts.
    const set = compileRuleSet({ urlRules: buildUrlRules("GET ~^https://a\\.com:(443|8443)/x$") });
    expect(set.https[0].hostMatch).toBe("hostBareFull");
    expect(set.https[0].hostRegex).toBe("^a\\.com:(443|8443)$");
    expect(set.https[0].port).toBe(null);
  });
});

describe("ip rule compilation", () => {
  it("keeps an address and its port", () => {
    const [rule] = compileRuleSet({ ipRules: ["10.0.0.5:5432"] }).ip;
    expect(rule.hostMatch).toBe("wildcard");
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

  it("matches a ~regex ip rule's address and port as one expression", () => {
    const [rule] = compileRuleSet({ ipRules: ["~^192\\.168\\.1\\.\\d+:(8080|8081)$"] }).ip;
    expect(rule.hostMatch).toBe("hostPort");
    expect(rule.address).toBe("^192\\.168\\.1\\.\\d+:(8080|8081)$");
    expect(rule.port).toBe(null);
  });

  it("rejects a ~regex ip rule with no port at all", () => {
    expect(() => compileRuleSet({ ipRules: ["~^192\\.168\\.1\\.\\d+$"] })).toThrow(
      /port is always required/,
    );
  });

  it("does not treat a literal address as a regex", () => {
    expect(compileRuleSet({ ipRules: ["10.0.0.5:5432"] }).ip[0].hostMatch).toBe("wildcard");
  });
});

describe("tls rule compilation", () => {
  it("keeps the host and the port it names", () => {
    const [rule] = compileRuleSet({ tlsRules: ["db.example.com:5432"] }).tls;
    expect(rule.hostMatch).toBe("wildcard");
    expect(rule.hostRegex).toBe("^db\\.example\\.com$");
    expect(rule.port).toBe("5432");
  });

  it("reports any-port as null", () => {
    expect(compileRuleSet({ tlsRules: ["db.example.com:*"] }).tls[0].port).toBe(null);
  });

  it("matches a ~regex host rule's host and port as one expression", () => {
    // "." and "*" would otherwise be rewritten by domainToRegexPartial's own
    // wildcard vocabulary; a ~ rule must skip that and use the regex as-is.
    const [rule] = compileRuleSet({ tlsRules: ["~^.*\\.example\\.com:(443|8443)$"] }).tls;
    expect(rule.hostMatch).toBe("hostPort");
    expect(rule.hostRegex).toBe("^.*\\.example\\.com:(443|8443)$");
    expect(rule.port).toBe(null);
  });

  it("rejects a ~regex host rule with no port at all", () => {
    expect(() => compileRuleSet({ tlsRules: ["~^example\\.com$"] })).toThrow(
      /port is always required/,
    );
  });
});

reportResults();

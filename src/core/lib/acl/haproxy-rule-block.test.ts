import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import { ruleBlock } from "./haproxy-rule-block.ts";
import { compileRuleSet, type RuleInputs } from "./haproxy-rules.ts";
import { buildUrlRules } from "./url-rules.ts";

/** One scheme's rule ACLs and its deny, as the generated config carries them. */
function block(inputs: RuleInputs, scheme: "https" | "http" = "https"): string {
  const compiled = compileRuleSet(inputs);
  return ruleBlock(scheme === "https" ? compiled.https : compiled.http, "restrict", scheme).join(
    "\n",
  );
}

describe("rule block", () => {
  it("matches a host case-insensitively, as a name is", () => {
    // do-resolve already lowercases the name it looks up, so a case-sensitive
    // acl blocks `Host: Registry.NPMJS.org` despite an explicit allow rule.
    // txn.host arrives lowercased, so the literal pattern must be lowercase
    // and a pattern that stays a regex keeps -i.
    const literal = block({ httpsRules: ["A.com:443"] });
    expect(literal).toContain("acl s0_host var(txn.host) -m str a.com");
    expect(block({ httpsRules: ["*.a.com:443"] })).toContain("-m reg -i ^[^.]+\\\\.a\\\\.com$");
  });

  it("reads no Host header of its own, however many rules are matched", () => {
    // Every rule matches txn.host. A fetch and its regsub per rule would be paid
    // per rule per request, and rule sets have no size limit.
    const config = block({
      urlRules: buildUrlRules(
        Array.from({ length: 8 }, (_, i) => `GET https://h${i}.com/x`).join("\n"),
      ),
    });
    expect(config).not.toContain("hdr(host)");
    expect(config).toContain("acl s7_host var(txn.host) -m str h7.com");
  });

  it("matches a literal name as a string and only a wildcard as a regex", () => {
    // An anchored regex over a literal name only ever matches that one name,
    // so the regex engine has nothing to decide.
    expect(block({ httpsRules: ["a.com:443"] })).toContain(
      "acl s0_host var(txn.host) -m str a.com",
    );
    expect(block({ httpsRules: ["*.a.com:443"] })).toContain(
      "acl s0_host var(txn.host) -m reg -i ^[^.]+\\\\.a\\\\.com$",
    );
  });

  it("matches a literal path as a string and a prefix path as a prefix", () => {
    const exact = block({ urlRules: buildUrlRules("GET https://a.com/pkg.json") });
    expect(exact).toContain("acl s0_path path -m str /pkg.json");
    const prefix = block({ urlRules: buildUrlRules("GET https://a.com/pkg/**") });
    expect(prefix).toContain("acl s0_path path -m beg /pkg/");
    // A single-segment wildcard is not a prefix: /pkg/a/b must stay blocked.
    const segment = block({ urlRules: buildUrlRules("GET https://a.com/pkg/*") });
    expect(segment).toContain("acl s0_path path -m reg ^/pkg/[^/]+$");
  });

  it("treats both spellings of an any-path rule as the same prefix", () => {
    // A host rule compiles to `^/` and `/**` to `^/.*$`; both permit any path,
    // and both still require the leading slash an `OPTIONS *` target lacks.
    expect(block({ httpsRules: ["a.com:443"] })).toContain("acl s0_path path -m beg /");
    expect(block({ urlRules: buildUrlRules("GET https://a.com/**") })).toContain(
      "acl s0_path path -m beg /",
    );
  });

  it("leaves a ~rule's own regex alone, quantifiers included", () => {
    // `/a+` is one or more `a` to the author. Read as a literal it would allow
    // only the path `/a+`, and `^/v+/x.*$` as a prefix would allow that same
    // literal `+` past a rule that never permitted it.
    const plus = block({ urlRules: buildUrlRules("GET ~^https://a\\.com/a+$") });
    expect(plus).toContain("acl s0_path path -m reg ^/a+$");
    const prefix = block({ urlRules: buildUrlRules("GET ~^https://a\\.com/v+/x.*$") });
    expect(prefix).toContain("acl s0_path path -m reg ^/v+/x.*$");
  });

  it("matches a name once, however many rules name it", () => {
    const config = block({
      urlRules: buildUrlRules("GET https://a.com/one/**\nGET https://a.com/two/**"),
    });
    expect(config).not.toContain("acl s1_host");
    expect(config).toContain(
      "bool(true) if !{ var(txn.allowed) -m bool } s0_host s1_port s1_path s1_method",
    );
  });

  it("stops matching once a rule has allowed the request", () => {
    // Without the flag first, every later rule still runs its own matching on
    // a request that is already allowed.
    const config = block({
      urlRules: buildUrlRules("GET https://a.com/x\nGET https://b.com/y"),
    });
    expect(config).toContain(
      "set-var(txn.allowed) bool(true) if !{ var(txn.allowed) -m bool } s1_host s1_port s1_path s1_method",
    );
  });

  it("takes the port from the connection, not from the Host header", () => {
    // A Host header omits the port only for a default one, so a matcher built
    // from it has to accept the port being absent. Left unchecked, that lets a
    // rule for :9443 also permit :443 on the same host.
    const config = block({ urlRules: buildUrlRules("GET https://a.com:9443/private/x") });
    expect(config).toContain("acl s0_host var(txn.host) -m str a.com");
    expect(config).toContain("acl s0_port dst_port 9443");
    expect(config).not.toContain("(:9443)?");
    expect(config).toContain(
      "bool(true) if !{ var(txn.allowed) -m bool } s0_host s0_port s0_path s0_method",
    );
  });

  it("gives a host rule the same treatment", () => {
    const config = block({ httpsRules: ["a.com:8443"] });
    expect(config).toContain("acl s0_host var(txn.host) -m str a.com");
    expect(config).toContain("acl s0_port dst_port 8443");
  });

  it("matches a ~regex host rule's host and port as one expression", () => {
    const config = block({ httpsRules: ["~^.*\\.example\\.com:(443|8443)$"] });
    expect(config).toContain("set-var-fmt(txn.host_port) %[var(txn.host)]:%[dst_port]");
    expect(config).toContain(
      "acl s0_host var(txn.host_port) -m reg -i ^.*\\\\.example\\\\.com:(443|8443)$",
    );
    // The pattern's own port coverage replaces dst_port entirely.
    expect(config).not.toContain("s0_port");
    expect(config).toContain("bool(true) if !{ var(txn.allowed) -m bool } s0_host s0_path");
  });

  it("omits the port acl only when the rule names every port", () => {
    const config = block({ httpsRules: ["a.com:*"] });
    expect(config).not.toContain("s0_port");
    expect(config).toContain("bool(true) if !{ var(txn.allowed) -m bool } s0_host s0_path");
  });

  it("matches the host and the path separately", () => {
    const config = block({ urlRules: buildUrlRules("GET https://a.com/pub/**") });
    expect(config).toContain("acl s0_host var(txn.host) -m str a.com");
    expect(config).toContain("acl s0_path path -m beg /pub/");
    expect(config).toContain("acl s0_method method GET");
    expect(config).toContain(
      "bool(true) if !{ var(txn.allowed) -m bool } s0_host s0_port s0_path s0_method",
    );
  });

  it("accepts a Host header with or without the port, since only the name is compared", () => {
    const config = block({ httpsRules: ["a.com:443"] });
    expect(config).toContain("acl s0_host var(txn.host) -m str a.com");
    expect(config).toContain("acl s0_port dst_port 443");
  });

  it("lets a host rule permit any path", () => {
    const config = block({ httpsRules: ["a.com:443"] });
    expect(config).toContain("acl s0_path path -m beg /");
    expect(config).not.toContain("s0_method");
  });

  it("splits rules by scheme, since the two arrive on different listeners", () => {
    const inputs = { urlRules: buildUrlRules("GET https://a.com/x\nGET http://b.com/y") };
    expect(block(inputs)).toContain("acl s0_host");
    expect(block(inputs, "http")).toContain("acl p0_host");
  });

  it("blocks everything for a scheme with no rules", () => {
    // The plaintext listener has no rules here, so it denies outright.
    const plain = block({ httpsRules: ["a.com:443"] }, "http");
    expect(plain).toContain("# No rules for this scheme, so nothing is permitted.");
  });

  it("escapes a special character in a path so it can't break the ACL line", () => {
    // A raw `"` (like a space or backslash) would otherwise let haproxy
    // misparse the line; escapeForHaproxy backslash-escapes it. A `#` is the
    // other such character, but rejectGluedHash keeps one out of every rule.
    const config = block({ urlRules: buildUrlRules('GET ~^https://a\\.com/pkg"x$') });
    expect(config).toContain('path -m reg ^/pkg\\"x$');
    expect(config).not.toContain('path -m reg ^/pkg"x$');
  });

  it("references named acls bare, since braces are for anonymous expressions", () => {
    const config = block({ httpsRules: ["a.com:443"] });
    expect(config).not.toContain("-m bool } { s0_host }");
    expect(config).toContain("bool(true) if !{ var(txn.allowed) -m bool } s0_host");
    // The verdict variable has no acl of its own, so it is the anonymous case.
    expect(config).toContain("http-request deny unless { var(txn.allowed) -m bool }");
  });
});

describe("regex url rules", () => {
  it("builds the shared full host variable and the default-port gate", () => {
    const segment = block({ urlRules: buildUrlRules("GET ~^https://a\\.com/x$") });
    expect(segment).toContain("acl is_default_port dst_port 443");
    expect(segment).toContain("set-var-fmt(txn.host_full) %[var(txn.host)]:%[dst_port]");
  });

  it("ORs a bare (default-port-only) match with a full (real-port) match per rule", () => {
    const segment = block({ urlRules: buildUrlRules("GET ~^https://a\\.com/x$") });
    expect(segment).toContain("set-var(txn.s0_ok) bool(false)");
    expect(segment).toContain(
      "set-var(txn.s0_ok) bool(true) if is_default_port { var(txn.host) -m reg -i ^a\\\\.com$ }",
    );
    expect(segment).toContain(
      "set-var(txn.s0_ok) bool(true) if { var(txn.host_full) -m reg -i ^a\\\\.com$ }",
    );
    expect(segment).toContain("acl s0_host var(txn.s0_ok) -m bool");
    expect(segment).toContain("path -m str /x");
    expect(segment).toContain(
      "bool(true) if !{ var(txn.allowed) -m bool } s0_host s0_path s0_method",
    );
    // No dst_port ACL at all: the bare/full duality covers the port.
    expect(segment).not.toContain("s0_port");
  });

  it("allows a non-literal port in the host half, matched as written", () => {
    const segment = block({ urlRules: buildUrlRules("GET ~^https://a\\.com:(443|8443)/x$") });
    expect(segment).toContain("-m reg -i ^a\\\\.com:(443|8443)$");
  });
});

reportResults();

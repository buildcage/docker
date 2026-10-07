import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import { inspectStage, type InspectStageExtension } from "./haproxy-inspect-stage.ts";
import { compileRuleSet, INTERNAL_RANGES, type RuleInputs } from "./haproxy-rules.ts";
import { buildUrlRules } from "./url-rules.ts";

/** An extension whose rules say only where they landed. */
const EXTENSION: InspectStageExtension = {
  requestRules: (mode) => [`    # extension request rules (${mode})`],
  responseRules: () => ["    # extension response rules"],
};

/** The TLS stage, as plainStage gives the plaintext one. */
function tlsStage(
  inputs: RuleInputs,
  mode: "restrict" | "audit",
  extension?: InspectStageExtension,
): string {
  return inspectStage(
    {
      name: "https_in",
      port: 10025,
      bindExtra: "",
      scheme: "https",
      rules: compileRuleSet(inputs).https,
      backend: "origin_tls",
    },
    { mode, internalAddrs: INTERNAL_RANGES, listenPort: 10024, extension },
  ).join("\n");
}

/** The plaintext stage for these rules, as the generated config carries it. */
function plainStage(
  inputs: RuleInputs,
  mode: "restrict" | "audit" = "restrict",
  extension?: InspectStageExtension,
): string {
  return inspectStage(
    {
      name: "http_in",
      port: 10026,
      bindExtra: "",
      scheme: "http",
      rules: compileRuleSet(inputs).http,
      backend: "origin_plain",
    },
    { mode, internalAddrs: INTERNAL_RANGES, listenPort: 10024, extension },
  ).join("\n");
}

describe("inspect stage", () => {
  it("refuses a request with no Host before it judges the path", () => {
    // Both are refusals, so only the reason turns on the order, and one of the
    // two names a host the report can act on where the other leaves the `-`
    // the log prints for a Host that never came. No rule is needed to see it:
    // both checks sit above the rule block whatever is written there.
    const plain = plainStage({});
    expect(plain.indexOf("missing-host-header") < plain.indexOf("path -m sub")).toBe(true);
  });

  it("sets the Host every step reads ahead of the rules, in audit too", () => {
    // Lowercased, as do-resolve looks a name up, and stripped of its port and
    // a trailing dot: "a.com." is the same DNS name as "a.com" (RFC 1035),
    // and some tools write it that way to skip resolv.conf's search list.
    const set = "http-request set-var(txn.host) req.hdr(host),lower,host_only,regsub(\\.$,)";
    const plain = plainStage({ httpRules: ["a.com:80"] });
    expect(plain.includes(set)).toBe(true);
    expect(plain.indexOf(set) < plain.indexOf("set-var(txn.allowed)")).toBe(true);
    // audit has no rule block, but still resolves from it.
    expect(plainStage({}, "audit").includes(set)).toBe(true);
  });

  it("refuses a Host that is not a hostname before any rule or resolution, in audit too", () => {
    // `Host: a.com:x.evil.com:80` keeps `a.com:x.evil.com` after host_only,
    // which `~^https?://a\.com:.*/.*$` would match and do-resolve look up.
    for (const mode of ["restrict", "audit"] as const) {
      const plain = plainStage({ httpRules: ["~^a\\.com:.*$"] }, mode);
      const deny = plain.indexOf("http-request deny deny_status 400 if !host_is_name");
      expect(plain.includes("acl host_is_name var(txn.host) -m reg ^[A-Za-z0-9._-]+$")).toBe(true);
      expect(plain.includes("set-var(txn.reason) str(invalid-host) if !host_is_name")).toBe(true);
      expect(deny > plain.indexOf("set-var(txn.host)")).toBe(true);
      expect(deny < plain.indexOf("do-resolve")).toBe(true);
      if (mode === "restrict") expect(deny < plain.indexOf("set-var(txn.allowed)")).toBe(true);
    }
  });

  it("writes nothing below a deny that carries no condition and so is final", () => {
    // HAProxy skips every http-request rule after an unconditional deny and
    // warns that they are NOOP. The resolver block is what would follow here.
    const plain = plainStage({ httpsRules: ["a.example.com:443"] });
    expect(plain.includes("# No rules for this scheme, so nothing is permitted.")).toBe(true);
    expect(plain.includes("do-resolve")).toBe(false);
    expect(plain.includes("acl dst_internal")).toBe(false);
  });

  it("exempts only where a rule that writes the address as its host matches", () => {
    const plain = plainStage({
      httpRules: ["169.254.169.254:8080", "127.0.0.3:*", "~^127\\.0\\.0\\.1:80$", "*.0.0.1:80"],
      urlRules: buildUrlRules("GET http://127.0.0.2/latest/**"),
    });
    const named = plain.split("\n").filter((l) => l.includes("set-var(txn.named_address)"));
    expect(named.length).toBe(3);
    expect(named[0].endsWith("-m str 169.254.169.254 } { dst_port 8080 } { path -m beg / }")).toBe(
      true,
    );
    expect(named[1].endsWith("-m str 127.0.0.3 } { path -m beg / }")).toBe(true);
    expect(
      named[2].endsWith(
        "-m str 127.0.0.2 } { dst_port 80 } { path -m beg /latest/ } { method GET }",
      ),
    ).toBe(true);
  });

  it("never exempts the proxy's own network or listener, which would loop back", () => {
    const plain = plainStage({ httpRules: ["127.0.0.1:10024"] });
    expect(plain.includes("acl dst_proxy_self var(txn.dst) -m ip 198.19.255.0/24")).toBe(true);
    expect(plain.includes("acl dst_proxy_self dst_port 10024")).toBe(true);
    expect(
      plain.includes(
        "deny deny_status 403 if dst_internal !named_address or dst_internal dst_proxy_self\n",
      ),
    ).toBe(true);
  });

  it("keeps the exemption in audit, where no rule is enforced", () => {
    // audit emits no rule block, so the exemption cannot lean on it.
    const plain = plainStage({ httpRules: ["169.254.169.254:80"] }, "audit");
    expect(plain.includes("txn.allowed")).toBe(false);
    expect(plain.includes("-m str 169.254.169.254 } { dst_port 80 }")).toBe(true);
    expect(plain.includes("deny deny_status 403 if dst_internal !named_address")).toBe(true);
  });
});

describe("extension", () => {
  const rules = { httpRules: ["~^b\\.example\\.com:80$"] };

  it("is left out, log field and all, when there is none", () => {
    const plain = plainStage(rules);
    expect(plain.includes("extension")).toBe(false);
    expect(plain.includes("wr=")).toBe(false);
  });

  it("logs what restrict would refuse ahead of the host", () => {
    const plain = plainStage(rules, "restrict", EXTENSION);
    expect(plain.includes("dst=%[dst]:%[dst_port] wr=%[var(txn.would_refuse)] host=")).toBe(true);
  });

  it("runs after the rules and before the name is resolved, told the mode", () => {
    const plain = plainStage(rules, "audit", EXTENSION);
    const decided = plain.indexOf("    # extension request rules (audit)");
    const resolved = plain.indexOf("do-resolve");
    expect(decided !== -1 && decided < resolved).toBe(true);
    const restrict = plainStage(rules, "restrict", EXTENSION);
    const allowed = restrict.indexOf("http-request deny unless { var(txn.allowed) -m bool }");
    expect(allowed !== -1 && allowed < restrict.indexOf("(restrict)")).toBe(true);
  });

  it("adds response rules to the TLS stage alone", () => {
    expect(
      tlsStage({ httpsRules: ["~^b\\.example\\.com:443$"] }, "audit", EXTENSION).includes(
        "extension response rules",
      ),
    ).toBe(true);
    expect(plainStage(rules, "audit", EXTENSION).includes("extension response rules")).toBe(false);
  });

  // Nothing may follow a deny that always fires; see deniesEverything.
  it("is left out where the rules refuse everything", () => {
    const plain = plainStage({}, "restrict", EXTENSION);
    expect(plain.includes("extension request rules")).toBe(false);
  });
});

reportResults();

import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import {
  escapeForCel,
  generateCorednsConfig,
  type CorednsConfigOptions,
} from "./coredns-config.ts";
import { compileRuleSet, type RuleInputs } from "./haproxy-rules.ts";
import { buildUrlRules } from "./url-rules.ts";

const BASE = { proxyAddress: "198.19.255.1" };

/** Rules and Corefile options in one bag, split apart by `gen` below. */
type CaseOptions = RuleInputs & Partial<CorednsConfigOptions>;

function gen({ httpsRules, httpRules, tlsRules, urlRules, ...options }: CaseOptions = {}) {
  return generateCorednsConfig(compileRuleSet({ httpsRules, httpRules, tlsRules, urlRules }), {
    ...BASE,
    ...options,
  });
}

/** The allowlist view's CEL expression line, as it would reach CoreDNS. */
function exprLine(config: string): string {
  return matchesLine(config, "view allowlist");
}

/** The CEL expression line of the view opened by `marker`. */
function matchesLine(config: string, marker: string): string {
  const start = config.indexOf(marker);
  if (start < 0) return "";
  return (
    config
      .slice(start)
      .split("\n")
      .find((l) => l.includes("name() matches")) ?? ""
  );
}

/**
 * The regex a CEL `matches` line carries, undoing its CEL escaping. A leading
 * `(?i)` becomes JS's `i` flag.
 */
function regexOf(exprLine: string): RegExp {
  const pattern = exprLine.replace(/\\\\/g, "\\");
  const body = pattern.slice(pattern.indexOf("'") + 1, pattern.lastIndexOf("'"));
  return body.startsWith("(?i)") ? new RegExp(body.slice(4), "i") : new RegExp(body);
}

/** From a view's declaration to the end of the block holding it. */
function blockOf(config: string, marker: string): string {
  const start = config.indexOf(marker);
  if (start < 0) return "";
  return config.slice(start, config.indexOf("\n}\n", start) + 3);
}

/** The service-discovery block on its own, or "" when the config emits none. */
function discoveryBlock(config: string): string {
  const start = config.indexOf("    view discovery {");
  if (start < 0) return "";
  const open = config.lastIndexOf(". {", start);
  return config.slice(open, config.indexOf("\n}\n", start) + 3);
}

/** The reverse-zone block on its own, which every config emits first. */
function reverseBlock(config: string): string {
  const start = config.indexOf("in-addr.arpa ip6.arpa {");
  return config.slice(start, config.indexOf("\n}\n", start) + 3);
}

// ---------------------------------------------------------------------------
// Nothing is ever forwarded, but a name is still logged as allowed or denied,
// and that decision has to match the rules and nothing more, or a name
// outside them would be misreported as allowed.
// ---------------------------------------------------------------------------
describe("readiness", () => {
  for (const mode of ["audit", "restrict"] as const) {
    it(`exposes a loopback health endpoint exactly once in ${mode} mode`, () => {
      // restrict has to emit the allowlist block as well, since that is the
      // case where declaring health twice would fail to start.
      const config = gen({ httpsRules: ["a.example.com:443"], mode });
      expect(config.split("\n").filter((l) => l.trim().startsWith("health ")).length).toBe(1);
      expect(config.includes("    health 127.0.0.1:8080")).toBe(true);
    });
  }
});

describe("allowlist scope", () => {
  it("logs only names matching the rule as allowed, not the whole parent domain", () => {
    // `*` is one label, so the resolver must not degrade to a suffix match on
    // `amazonaws.com`: that would misreport, as allowed, every name beneath it.
    const config = gen({ urlRules: buildUrlRules("GET https://*.amazonaws.com/x") });
    const regex = regexOf(exprLine(config));
    expect(regex.test("a.amazonaws.com.")).toBe(true);
    expect(regex.test("secret.deep.amazonaws.com.")).toBe(false);
    expect(regex.test("amazonaws.com.")).toBe(false);
  });

  it("** crosses labels where the rule says so", () => {
    const config = gen({ urlRules: buildUrlRules("GET https://**.amazonaws.com/x") });
    const regex = regexOf(exprLine(config));
    expect(regex.test("secret.deep.amazonaws.com.")).toBe(true);
  });

  it("anchors both ends, including the trailing dot a query carries", () => {
    const expr = exprLine(gen({ httpsRules: ["a.example.com:443"] }));
    expect(expr.includes("matches '(?i)^(")).toBe(true);
    expect(expr.trimEnd().endsWith(")[.]$'")).toBe(true);
  });

  it("matches a name in any case, as the proxy does", () => {
    const regex = regexOf(exprLine(gen({ httpsRules: ["Registry.NPMJS.org:443"] })));
    expect(regex.test("registry.npmjs.org.")).toBe(true);
    expect(regex.test("REGISTRY.npmjs.ORG.")).toBe(true);
  });

  it("marks every view expression case-insensitive", () => {
    const config = gen({ httpsRules: ["a.example.com:443"] });
    const lines = config.split("\n").filter((l) => l.includes("name() matches"));
    expect(lines.length).toBe(4);
    for (const line of lines) expect(line.includes("matches '(?i)")).toBe(true);
  });

  it("combines every rule into one alternation", () => {
    const config = gen({ httpsRules: ["a.example.com:443", "b.example.com:443"] });
    const allowlist = blockOf(config, "view allowlist");
    expect(exprLine(config).includes("|")).toBe(true);
    expect(allowlist.split("\n").filter((l) => l.includes("name() matches")).length).toBe(1);
  });

  it("does not repeat a host shared by several rules", () => {
    const config = gen({
      urlRules: buildUrlRules("GET https://a.com/x/*\nPOST https://a.com/y/*"),
    });
    const expr = exprLine(config);
    expect(expr.split("a\\\\.com").length - 1).toBe(1);
  });

  it("takes the host from http rules too", () => {
    expect(exprLine(gen({ httpRules: ["a.example.com:80"] })).includes("a")).toBe(true);
  });

  it("takes the host from an http url rule, which still has to resolve", () => {
    const result = gen({
      urlRules: buildUrlRules("GET http://a.example.com/x"),
    });
    expect(exprLine(result).includes("a\\\\.example\\\\.com")).toBe(true);
  });

  it("takes the host from a tls rule, which resolves though it is not inspected", () => {
    // A passthrough is judged on SNI and never decrypted, but the proxy still
    // resolves the name to decide where to connect, so it must be forwarded.
    expect(
      exprLine(gen({ tlsRules: ["db.example.com:5432"] })).includes("db\\\\.example\\\\.com"),
    ).toBe(true);
  });

  it("takes the host from a ~regex host rule instead of mangling it as a wildcard", () => {
    const result = gen({
      tlsRules: ["~^.*\\.example\\.com:8443$"],
    });
    expect(exprLine(result).includes(".*\\\\.example\\\\.com")).toBe(true);
  });

  it("takes the host from a ~regex url rule, with its port stripped from the host match", () => {
    const result = gen({
      urlRules: buildUrlRules("GET ~^https://a\\.com:8443/x$"),
    });
    expect(exprLine(result).includes("a\\\\.com")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CEL escaping. Verified against CoreDNS: a single backslash is rejected as an
// invalid character escape, and doubling is what survives into the regex.
// ---------------------------------------------------------------------------
describe("CEL escaping", () => {
  it("doubles every backslash", () => {
    expect(escapeForCel("a\\.b")).toBe("a\\\\.b");
  });

  it("doubles escapes other than the dot, which a ~ rule may contain", () => {
    expect(escapeForCel("a\\+b\\$c")).toBe("a\\\\+b\\\\$c");
  });

  it("leaves the generated expression with no single backslash", () => {
    const expr = exprLine(gen({ httpsRules: ["a.example.com:443"] }));
    expect(/(^|[^\\])\\(?!\\)/.test(expr)).toBe(false);
  });
});

describe("denied names", () => {
  const config = gen({ httpsRules: ["a.example.com:443"] });

  it("resolves them to the proxy so their URL can still be recorded", () => {
    expect(config.includes('answer "{{ .Name }} 60 IN A 198.19.255.1"')).toBe(true);
  });

  it("answers locally, so the query is never forwarded", () => {
    // The deny block has no forward directive of its own.
    const denyBlock = config.slice(config.indexOf("# Everything else"));
    expect(denyBlock.includes("forward")).toBe(false);
  });

  it("answers AAAA with NODATA rather than an unusable address or NXDOMAIN", () => {
    // Scoped to the deny block specifically: the allow block above it has its
    // own AAAA template, identical in shape, and a plain indexOf would find that
    // one first.
    const denyBlock = config.slice(config.indexOf("# Everything else"));
    const aaaaBlock = denyBlock.slice(denyBlock.indexOf("template IN AAAA"));
    expect(aaaaBlock.includes("answer")).toBe(false);
    expect(denyBlock.includes("rcode NXDOMAIN")).toBe(false);
  });

  it("answers every other query type with NODATA rather than leaving it unhandled", () => {
    // A type that reaches no template at all is answered SERVFAIL, which says
    // the server is broken and the query worth retrying: musl waits out its
    // whole resolver timeout on one. NODATA refuses it without the wait.
    const denyBlock = config.slice(config.indexOf("# Everything else"));
    const anyBlock = denyBlock.slice(denyBlock.indexOf("template IN ANY"));
    expect(denyBlock.includes("template IN ANY")).toBe(true);
    expect(anyBlock.includes("answer")).toBe(false);
  });

  it("keeps the A template ahead of the catch-all, which matches every type", () => {
    // CoreDNS takes the first template that matches, so the order in the file
    // is what stops IN ANY from answering an A query with NODATA.
    const denyBlock = config.slice(config.indexOf("# Everything else"));
    expect(denyBlock.indexOf("template IN A {") < denyBlock.indexOf("template IN ANY {")).toBe(
      true,
    );
  });

  it("labels the two paths distinguishably in the log", () => {
    expect(config.includes('"buildcage dns allowed name={name}"')).toBe(true);
    expect(config.includes('"buildcage dns denied name={name}"')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Allowed names: answered exactly like a denied one. Real resolution is
// HAProxy's job, strictly after a request has already passed its own rule
// ACLs (host, path and method); see haproxy-config.ts. Nothing about a name
// being on the allowlist may change what CoreDNS answers with, or a name a
// build only resolves, never connecting to, would leak through the query
// alone.
// ---------------------------------------------------------------------------
describe("allowed names", () => {
  const config = gen({ httpsRules: ["a.example.com:443"] });
  const allowBlock = blockOf(config, "view allowlist");
  const denyBlock = config.slice(config.indexOf("# Everything else"));
  // Both blocks share proxyAnswerLines() in the generator, so comparing them
  // proves they cannot drift apart, which re-asserting each block's shape
  // separately would not.
  const answerLines = (s: string) =>
    s
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("template") || l.startsWith("answer"))
      .join("\n");

  it("answers exactly like a denied name", () => {
    expect(answerLines(allowBlock)).toBe(answerLines(denyBlock));
  });

  it("never forwards, even for a name the rules allow", () => {
    expect(allowBlock.includes("forward")).toBe(false);
  });

  it("logs it as allowed, the one place it differs from a denied name", () => {
    expect(allowBlock.includes('"buildcage dns allowed name={name}"')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// audit has no allowlist to enforce, but it must not forward either: it
// records every lookup while still answering it locally.
// ---------------------------------------------------------------------------
describe("audit mode", () => {
  const config = gen({ ...BASE, httpsRules: ["a.example.com:443"], mode: "audit" });

  it("answers every name locally instead of forwarding it", () => {
    // Forwarding would make this resolver a live exfiltration channel for any
    // name a build only looks up, never connecting to. Audit mode's own
    // allow-everything policy is HAProxy's job (do-resolve after the ACLs),
    // not this resolver's.
    expect(config.includes("template IN A")).toBe(true);
    expect(config.includes('answer "{{ .Name }} 60 IN A 198.19.255.1"')).toBe(true);
    expect(config.includes("forward")).toBe(false);
  });

  it("still records every name that was looked up", () => {
    expect(config.includes('"buildcage dns allowed name={name}"')).toBe(true);
    expect(config.includes("buildcage dns denied")).toBe(false);
  });

  it("needs no allowlist expression, since nothing is refused", () => {
    expect(config.includes("view allowlist")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Reverse lookups. No rule can name a reverse zone, so the only question these
// answer is how the lookup ends, and SERVFAIL, what an unhandled query gets,
// costs musl its whole five-second resolver timeout every time.
// ---------------------------------------------------------------------------
describe("reverse lookups", () => {
  for (const mode of ["audit", "restrict"] as const) {
    it(`answers PTR with NXDOMAIN in ${mode} mode, so the caller gives up at once`, () => {
      const block = reverseBlock(gen({ httpsRules: ["a.example.com:443"], mode }));
      expect(block.includes("template IN PTR")).toBe(true);
      expect(block.includes("rcode NXDOMAIN")).toBe(true);
    });
  }

  it("carries an SOA, so the refusal is cacheable rather than re-asked each time", () => {
    expect(reverseBlock(gen({})).includes("IN SOA ns.buildcage.invalid.")).toBe(true);
  });

  it("records the lookup under a verb of its own, neither allowed nor denied", () => {
    // inspect.ts reads the allowed and denied verbs only, which is what keeps
    // this out of the report: a row for a reverse zone could never be taken
    // away by writing a rule, there being no rule that can name one.
    const block = reverseBlock(gen({ httpsRules: ["a.example.com:443"] }));
    expect(block.includes('"buildcage dns reverse name={name}"')).toBe(true);
    expect(block.includes("dns allowed")).toBe(false);
    expect(block.includes("dns denied")).toBe(false);
  });

  it("answers anything else under those zones like any other name", () => {
    // Only PTR is refused. A name that merely sits under in-addr.arpa still
    // resolves to the proxy, so the request that follows is recorded with its
    // full URL the way one for any other name is.
    expect(reverseBlock(gen({})).includes('answer "{{ .Name }} 60 IN A 198.19.255.1"')).toBe(true);
  });

  it("never forwards, no more than any other block does", () => {
    expect(reverseBlock(gen({})).includes("forward")).toBe(false);
  });

  it("takes only names that really are an address backwards", () => {
    // The verb this block logs under is one the report layer drops, so without
    // the view an exfiltration attempt would vanish from the report by having
    // `.in-addr.arpa` appended to it. Everything else under these zones misses
    // the view and falls through to the blocks below, which judge it as usual.
    const regex = regexOf(matchesLine(gen({}), "view reverse"));
    expect(regex.test("1.255.19.198.in-addr.arpa.")).toBe(true);
    expect(regex.test("255.19.198.in-addr.arpa.")).toBe(true);
    expect(regex.test("8.b.d.0.1.0.0.2.ip6.arpa.")).toBe(true);
    expect(regex.test("secret-data.in-addr.arpa.")).toBe(false);
    expect(regex.test("1.2.3.4.in-addr.arpa.attacker.example.")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Service discovery. No rule can permit one of these: this resolver returns no
// discovery record to anybody, so a denied row for one could never be taken
// away by writing a rule, and would fail a build under fail_on_blocked over
// a lookup the caller falls back from on its own.
// ---------------------------------------------------------------------------
describe("service-discovery names", () => {
  const RULES = { httpsRules: ["deb.debian.org:443"] };

  for (const mode of ["audit", "restrict"] as const) {
    it(`records the lookup under a verb of its own in ${mode} mode`, () => {
      const block = discoveryBlock(gen({ ...RULES, mode }));
      expect(block.includes('"buildcage dns discovery name={name} type={type}"')).toBe(true);
      expect(block.includes("dns allowed")).toBe(false);
      expect(block.includes("dns denied")).toBe(false);
    });
  }

  it("carries the query type, which is the whole point of the lookup", () => {
    // Only the type tells a fallback nobody notices from an outright failure.
    expect(discoveryBlock(gen(RULES)).includes("type={type}")).toBe(true);
  });

  it("answers NODATA for SRV rather than NXDOMAIN or SERVFAIL", () => {
    // What nearly every name on the internet gives for SRV, and what every
    // caller that uses SRV as a discovery layer already falls back from.
    const block = discoveryBlock(gen(RULES));
    expect(block.includes("template IN ANY {\n    }")).toBe(true);
    expect(block.includes("rcode")).toBe(false);
  });

  it("never forwards, no more than any other block does", () => {
    expect(discoveryBlock(gen(RULES)).includes("forward")).toBe(false);
  });

  it("takes only a service name under a host the rules already allow", () => {
    // The report keeps this verb out of the blocked table, so a name that
    // reaches it is a name that left that table. Being shaped like a service
    // name is not enough to earn that: `_a._tcp.` in front of anything at all
    // would otherwise take it out.
    const regex = regexOf(matchesLine(gen(RULES), "view discovery"));
    expect(regex.test("_http._tcp.deb.debian.org.")).toBe(true);
    expect(regex.test("_a._tcp.secret-data.attacker.example.")).toBe(false);
    expect(regex.test("_a._tcp.secret-data.deb.debian.org.")).toBe(false);
  });

  it("bounds how much of the name the caller chooses", () => {
    // Everything before the allowed host is a label the caller picks, so it is
    // held to what RFC 6335 lets a service name be and to the transports
    // RFC 2782 defines.
    const regex = regexOf(matchesLine(gen(RULES), "view discovery"));
    expect(regex.test("_xmpp-client._tcp.deb.debian.org.")).toBe(true);
    expect(regex.test("_sip._udp.deb.debian.org.")).toBe(true);
    expect(regex.test("_averyverylongservicename._tcp.deb.debian.org.")).toBe(false);
    expect(regex.test("_a._secret._tcp.deb.debian.org.")).toBe(false);
    expect(regex.test("_dmarc.deb.debian.org.")).toBe(false);
  });

  it("exempts only the types defined at a service name, denying the rest", () => {
    // An A query really is answered here, with the proxy's address, and a type
    // this block has never heard of is not one to exempt on a guess, so both
    // are judged by the blocks below instead.
    const block = discoveryBlock(gen(RULES));
    expect(block.includes("expr type() in ['SRV', 'TXT', 'TLSA', 'URI']")).toBe(true);
  });

  it("takes a service name under any host in audit mode, which refuses nothing", () => {
    // There is no blocked table in audit, so there is none to leave.
    const regex = regexOf(matchesLine(gen({ mode: "audit" }), "view discovery"));
    expect(regex.test("_mongodb._tcp.cluster0.abcde.mongodb.net.")).toBe(true);
  });

  it("emits no block at all when restrict allows no host", () => {
    // Nothing can be under an allowed host, so every name is denied as usual.
    expect(gen({}).includes("view discovery")).toBe(false);
  });

  it("comes before the blocks that would otherwise deny the name", () => {
    // CoreDNS takes the first block whose view matches, and the deny block has
    // no view at all, so order is what decides this.
    const config = gen(RULES);
    expect(config.indexOf("view discovery") < config.indexOf("view allowlist")).toBe(true);
    expect(config.indexOf("view discovery") < config.indexOf("buildcage dns denied")).toBe(true);
  });

  it("comes before the catch-all in audit mode too", () => {
    const config = gen({ mode: "audit" });
    expect(config.indexOf("view discovery") < config.indexOf("buildcage dns allowed")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Every other service name. Refused like any other name, but recorded apart:
// the remedy for one is the host below it, never the name, which no rule can
// make resolve. Logging it apart is also what keeps the shape of a service
// name defined in coredns-config.ts alone: the report reads verbs, not names.
// ---------------------------------------------------------------------------
describe("refused service names", () => {
  it("records them under a verb of their own, carrying the type", () => {
    const block = blockOf(gen({ httpsRules: ["deb.debian.org:443"] }), "view service");
    expect(block.includes('"buildcage dns service-denied name={name} type={type}"')).toBe(true);
  });

  it("comes after the allowlist, so an explicit rule still reads as allowed", () => {
    // Someone who did write a rule naming a service name gets what they asked
    // for; only names no rule covers reach this block.
    const config = gen({ httpsRules: ["deb.debian.org:443"] });
    expect(config.indexOf("view allowlist") < config.indexOf("view service")).toBe(true);
    expect(config.indexOf("view service") < config.indexOf("buildcage dns denied")).toBe(true);
  });

  it("takes every service name, under any host", () => {
    // Whatever missed the discovery block above: the wrong host, or a type not
    // defined at a service name.
    const regex = regexOf(matchesLine(gen({ httpsRules: ["deb.debian.org:443"] }), "view service"));
    expect(regex.test("_mongodb._tcp.cluster0.abcde.mongodb.net.")).toBe(true);
    expect(regex.test("_http._tcp.deb.debian.org.")).toBe(true);
    expect(regex.test("secret-data.attacker.example.")).toBe(false);
    expect(regex.test("_dmarc.example.com.")).toBe(false);
  });

  it("is emitted even when no host is allowed at all", () => {
    // The remedy it points at does not depend on there being rules already.
    expect(gen({}).includes("view service")).toBe(true);
  });

  it("is not emitted in audit mode, which refuses nothing", () => {
    expect(gen({ mode: "audit" }).includes("view service")).toBe(false);
  });
});

describe("degenerate inputs", () => {
  it("emits only the deny block when there are no rules", () => {
    const config = gen({});
    expect(config.includes("view allowlist")).toBe(false);
    expect(config.includes("buildcage dns denied")).toBe(true);
  });
});

reportResults();

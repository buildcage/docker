import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import { escapeForCel, generateCorednsConfig } from "./coredns-config.ts";
import { buildUrlRules } from "./url-rules.ts";

const BASE = { proxyAddress: "172.20.0.1" };

function gen(options: Partial<Parameters<typeof generateCorednsConfig>[0]> = {}): string {
  return generateCorednsConfig({ ...BASE, ...options }).config;
}

/** The CEL expression line, as it would reach CoreDNS. */
function exprLine(config: string): string {
  return config.split("\n").find((l) => l.includes("name() matches")) ?? "";
}

// ---------------------------------------------------------------------------
// Nothing is ever forwarded, but a name is still logged as allowed or denied,
// and that decision has to match the rules and nothing more, or a name
// outside them would be misreported as allowed.
// ---------------------------------------------------------------------------
describe("allowlist scope", () => {
  it("logs only names matching the rule as allowed, not the whole parent domain", () => {
    // `*` is one label, so the resolver must not degrade to a suffix match the
    // way dnsmasq's `/amazonaws.com/` would: that would misreport, as allowed,
    // every name beneath it.
    const config = gen({ urlRules: buildUrlRules("GET https://*.amazonaws.com/x") });
    const pattern = exprLine(config).replace(/\\\\/g, "\\");
    const regex = new RegExp(pattern.slice(pattern.indexOf("'") + 1, pattern.lastIndexOf("'")));
    expect(regex.test("a.amazonaws.com.")).toBe(true);
    expect(regex.test("secret.deep.amazonaws.com.")).toBe(false);
    expect(regex.test("amazonaws.com.")).toBe(false);
  });

  it("** crosses labels where the rule says so", () => {
    const config = gen({ urlRules: buildUrlRules("GET https://**.amazonaws.com/x") });
    const pattern = exprLine(config).replace(/\\\\/g, "\\");
    const regex = new RegExp(pattern.slice(pattern.indexOf("'") + 1, pattern.lastIndexOf("'")));
    expect(regex.test("secret.deep.amazonaws.com.")).toBe(true);
  });

  it("anchors both ends, including the trailing dot a query carries", () => {
    const expr = exprLine(gen({ httpsRules: ["a.example.com:443"] }));
    expect(expr.includes("matches '^(")).toBe(true);
    expect(expr.trimEnd().endsWith(")[.]$'")).toBe(true);
  });

  it("combines every rule into one alternation", () => {
    const config = gen({ httpsRules: ["a.example.com:443", "b.example.com:443"] });
    expect(exprLine(config).includes("|")).toBe(true);
    expect(config.split("\n").filter((l) => l.includes("name() matches")).length).toBe(1);
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
    const result = generateCorednsConfig({
      ...BASE,
      urlRules: buildUrlRules("GET http://a.example.com/x"),
    });
    expect(exprLine(result.config).includes("a\\\\.example\\\\.com")).toBe(true);
    expect(result.warnings.length).toBe(0);
  });

  it("takes the host from a tls rule, which resolves though it is not inspected", () => {
    // A passthrough is judged on SNI and never decrypted, but the proxy still
    // resolves the name to decide where to connect, so it must be forwarded.
    expect(
      exprLine(gen({ tlsRules: ["db.example.com:5432"] })).includes("db\\\\.example\\\\.com"),
    ).toBe(true);
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

// ---------------------------------------------------------------------------
// Denied names
// ---------------------------------------------------------------------------
describe("denied names", () => {
  const config = gen({ httpsRules: ["a.example.com:443"] });

  it("resolves them to the proxy so their URL can still be recorded", () => {
    expect(config.includes('answer "{{ .Name }} 60 IN A 172.20.0.1"')).toBe(true);
  });

  it("answers locally, so the query is never forwarded", () => {
    // The deny block has no forward directive of its own.
    const denyBlock = config.slice(config.indexOf("# Everything else"));
    expect(denyBlock.includes("forward")).toBe(false);
  });

  it("answers AAAA with NODATA rather than an unusable address or NXDOMAIN", () => {
    // NXDOMAIN would tell musl's getaddrinfo the name doesn't exist at all,
    // discarding the valid A answer above along with it. Scoped to the deny
    // block specifically: the allow block above it has its own AAAA template,
    // identical in shape, and a plain indexOf would find that one first.
    const denyBlock = config.slice(config.indexOf("# Everything else"));
    const aaaaBlock = denyBlock.slice(denyBlock.indexOf("template IN AAAA"));
    expect(aaaaBlock.includes("answer")).toBe(false);
    expect(config.includes("rcode NXDOMAIN")).toBe(false);
  });

  it("labels the two paths distinguishably in the log", () => {
    expect(config.includes('"buildcage dns allowed name={name}"')).toBe(true);
    expect(config.includes('"buildcage dns denied name={name}"')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Allowed names: answered exactly like a denied one. Real resolution is
// HAProxy's job, strictly after a request has already passed its own rule
// ACLs (host, path and method) -- see haproxy-config.ts. Nothing about a name
// being on the allowlist may change what CoreDNS answers with, or a name a
// build only resolves, never connecting to, would leak through the query
// alone.
// ---------------------------------------------------------------------------
describe("allowed names", () => {
  const config = gen({ httpsRules: ["a.example.com:443"] });
  const allowBlock = config.slice(
    config.indexOf("view allowlist"),
    config.indexOf("# Everything else"),
  );
  const denyBlock = config.slice(config.indexOf("# Everything else"));
  // Both blocks share proxyAnswerLines() in the generator, so this is a
  // stronger, single check in place of separately re-asserting the same
  // answer/AAAA shape "denied names" above already covers in full: it proves
  // the two cannot drift apart, not just that each happens to look right.
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
// records without connecting to anything CoreDNS resolved for real.
// ---------------------------------------------------------------------------
describe("audit mode", () => {
  const config = gen({ ...BASE, httpsRules: ["a.example.com:443"], mode: "audit" });

  it("answers every name locally instead of forwarding it", () => {
    // Forwarding would make this resolver a live exfiltration channel for any
    // name a build only looks up, never connecting to -- audit mode's own
    // allow-everything policy is HAProxy's job (do-resolve after the ACLs),
    // not this resolver's.
    expect(config.includes("template IN A")).toBe(true);
    expect(config.includes('answer "{{ .Name }} 60 IN A 172.20.0.1"')).toBe(true);
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
// Degenerate inputs
// ---------------------------------------------------------------------------
describe("degenerate inputs", () => {
  it("emits only the deny block when there are no rules", () => {
    const config = gen({});
    expect(config.includes("view allowlist")).toBe(false);
    expect(config.includes("buildcage dns denied")).toBe(true);
  });

  it("warns for a regex rule whose host cannot be derived", () => {
    const result = generateCorednsConfig({
      ...BASE,
      urlRules: buildUrlRules("GET ~^https://a\\.com/x$"),
    });
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0].includes("will not resolve")).toBe(true);
    expect(result.config.includes("view allowlist")).toBe(false);
  });
});

reportResults();

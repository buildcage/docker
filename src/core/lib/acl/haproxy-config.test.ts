import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import { generateHaproxyConfig } from "./haproxy-config.ts";
import { buildUrlRules } from "./url-rules.ts";

function gen(options: Parameters<typeof generateHaproxyConfig>[0] = {}): string {
  return generateHaproxyConfig(options).config;
}

/** HAProxy's own per-line word cap (MAX_LINE_ARGS); it truncates past this. */
const MAX_LINE_WORDS = 64;

function longestLineWords(config: string): number {
  return config
    .split("\n")
    .reduce((most, line) => Math.max(most, line.trim().split(/\s+/).filter(Boolean).length), 0);
}

/** The text of one `frontend <name> ... ` block, up to the next `frontend`. */
function frontendSegment(config: string, name: string): string {
  const start = config.indexOf(`frontend ${name}`);
  const nextFrontend = config.indexOf("\nfrontend", start + 1);
  return config.slice(start, nextFrontend === -1 ? undefined : nextFrontend);
}

const FULL = {
  httpsRules: ["a.example.com:443"],
  httpRules: ["b.example.com:80"],
  ipRules: ["10.0.0.5:5432"],
  tlsRules: ["db.example.com:443"],
  resolverAddress: ["1.1.1.1", "8.8.8.8"],
  proxyAddress: "172.20.0.1",
};

// Each of the directives these cases name still lets ordinary traffic through
// when omitted, so none of them can be caught by testing the happy path.
const FULL_CONFIG = gen(FULL);

describe("the proxy's own process and listeners", () => {
  it("exposes readiness on a unix socket, out of reach of the firewall", () => {
    // s6-notifyoncheck polls this; a TCP health port would depend on what
    // init-iptables allows, and a blocked check never signals ready.
    const health = frontendSegment(FULL_CONFIG, "health");
    expect(health.includes("bind /var/run/haproxy-health.sock mode 666")).toBe(true);
    expect(health.includes("monitor-uri /health")).toBe(true);
  });

  it("drops to an unprivileged user", () => {
    expect(FULL_CONFIG.includes("\n    user haproxy\n")).toBe(true);
    expect(FULL_CONFIG.includes("\n    group haproxy\n")).toBe(true);
  });

  it("states the resolver's address family, leaving it nothing to read off the host", () => {
    expect(FULL_CONFIG.includes("\n    dns-accept-family ipv4\n")).toBe(true);
    // A do-resolve asking for a family the global setting never queries comes
    // back with nothing, so the two have to agree.
    const resolves = FULL_CONFIG.split("\n").filter((l) => l.includes("do-resolve("));
    expect(resolves.length > 0).toBe(true);
    expect(resolves.every((l) => l.includes(",ipv4)"))).toBe(true);
  });

  it("classifies by the first bytes, so no port is declared in advance", () => {
    // This is what lets audit record everything without being configured.
    expect(FULL_CONFIG.includes("acl is_tls req.ssl_hello_type 1")).toBe(true);
    expect(FULL_CONFIG.includes("use_backend to_tls if is_tls")).toBe(true);
  });
});

describe("where a request is sent", () => {
  it("connects where it resolved the name, not where the client aimed", () => {
    // Removes the forged-Host class of attack rather than detecting it.
    expect(
      FULL_CONFIG.includes(
        "http-request do-resolve(txn.dst,buildcage,ipv4) req.hdr(host),lower,host_only",
      ),
    ).toBe(true);
    expect(FULL_CONFIG.includes("http-request set-dst var(txn.dst)")).toBe(true);
  });

  it("strips the port before resolving, so a non-default port still resolves", () => {
    // A Host header carries the port for a non-default port. Resolving the
    // whole "name:port" string matches no allowlist entry, so the request is
    // answered with the proxy's own address and reaches nothing.
    expect(
      FULL_CONFIG.includes("do-resolve(txn.dst,buildcage,ipv4) req.hdr(host),lower,host_only"),
    ).toBe(true);
    // An SNI is a name, never a name and a port, and the origin certificate is
    // verified against it.
    expect(FULL_CONFIG.includes("sni req.hdr(host),lower,host_only")).toBe(true);
  });

  it("takes an address in the Host header as it stands, asking no resolver", () => {
    // No resolver can answer an address, so asking would fail and refuse the
    // request, leaving a rule that names an address impossible to satisfy.
    expect(
      FULL_CONFIG.includes(
        "acl host_is_address req.hdr(host),host_only,regsub(\\.$,) -m reg ^(25[0-5]",
      ),
    ).toBe(true);
    expect(
      FULL_CONFIG.includes(
        "http-request set-var(txn.dst) req.hdr(host),host_only,regsub(\\.$,) if host_is_address",
      ),
    ).toBe(true);
    expect(
      FULL_CONFIG.includes("req.hdr(host),lower,host_only,regsub(\\.$,) unless host_is_address"),
    ).toBe(true);
  });

  it("is strict about the octets, since what matches is never checked again", () => {
    // Whatever the pattern admits goes to set-dst unresolved. 999.1.2.3,
    // 010.0.0.1 and 1.2.3.4.evil.example must all fail it and fall through to
    // the resolver, which cannot answer them either.
    const acl = FULL_CONFIG.split("\n").find((l) => l.includes("acl host_is_address"))!;
    const regex = new RegExp(acl.slice(acl.indexOf("-m reg ") + 7));
    expect(regex.test("10.0.0.5")).toBe(true);
    expect(regex.test("255.255.255.255")).toBe(true);
    expect(regex.test("999.1.2.3")).toBe(false);
    expect(regex.test("010.0.0.1")).toBe(false);
    expect(regex.test("1.2.3.4.evil.example")).toBe(false);
    expect(regex.test("1.2.3")).toBe(false);
  });

  it("refuses a request whose name it could not resolve", () => {
    expect(
      FULL_CONFIG.includes("http-request deny deny_status 502 unless { var(txn.dst) -m found }"),
    ).toBe(true);
  });
});

describe("resolving, which only a request the rules already admitted reaches", () => {
  it("denies on host, path and method before resolving, on both listeners", () => {
    for (const frontend of ["https_in", "http_in"]) {
      const segment = frontendSegment(FULL_CONFIG, frontend);
      const firstRule = segment.indexOf("set-var(txn.allowed) bool(true)");
      const deny = segment.indexOf("http-request deny unless");
      const resolve = segment.indexOf("do-resolve(txn.dst,buildcage,ipv4) req.hdr(host)");
      expect(firstRule).not.toBe(-1);
      expect(resolve).not.toBe(-1);
      expect(firstRule < deny && deny < resolve).toBe(true);
    }
  });

  it("sets the resolved destination before the internal-address check, not after", () => {
    // %[dst] in the log-format reads whatever set-dst last wrote. CoreDNS
    // never hands the build a real address (see coredns-config.ts), so a
    // refusal logged before set-dst ran would show the build's own fake
    // destination instead of the real one that tripped the guard, silently
    // losing the address that makes the refusal worth recording.
    for (const frontend of ["https_in", "http_in"]) {
      const segment = frontendSegment(FULL_CONFIG, frontend);
      const setDst = segment.indexOf("http-request set-dst var(txn.dst)");
      const internalDeny = segment.indexOf("deny deny_status 403 if dst_internal");
      expect(setDst).not.toBe(-1);
      expect(internalDeny).not.toBe(-1);
      expect(setDst < internalDeny).toBe(true);
    }
  });

  it("does the same for a passthrough, which logs its own destination too", () => {
    const setDst = FULL_CONFIG.indexOf("tcp-request content set-dst var(txn.dst)");
    const internalReject = FULL_CONFIG.indexOf(
      "reject if { var(txn.tlsrule) -m found } pass_dst_internal",
    );
    expect(setDst).not.toBe(-1);
    expect(internalReject).not.toBe(-1);
    expect(setDst < internalReject).toBe(true);
  });

  it("gates the passthrough's do-resolve on the same SNI match that admits it", () => {
    // Not just ordering: a passthrough rule has no path or method, so this
    // flag, set only when an SNI already matched, is the entire rule
    // check do-resolve sits behind. A request no rule admits must never reach
    // it, which is the same invariant as the host+path+method check above.
    const tlsRuleSet = FULL_CONFIG.indexOf("set-var(txn.tlsrule)");
    const resolveLine = FULL_CONFIG.split("\n").find((l) =>
      l.includes("do-resolve(txn.dst,buildcage,ipv4) req.ssl_sni"),
    )!;
    const resolve = FULL_CONFIG.indexOf(resolveLine);
    expect(tlsRuleSet).not.toBe(-1);
    expect(resolveLine).toBeTruthy();
    expect(tlsRuleSet < resolve).toBe(true);
    expect(resolveLine.includes("if { var(txn.tlsrule) -m found }")).toBe(true);
  });

  it("still resolves on both listeners when it does, rather than trusting the client", () => {
    // do-resolve sits behind the same flag the nameserver lines do. Missed
    // here, set-dst would never run and the connection would go wherever the
    // client's own address said.
    const resolvConf = gen({ ...FULL, resolverAddress: [], useResolvConf: true });
    for (const frontend of ["https_in", "http_in"]) {
      const segment = frontendSegment(resolvConf, frontend);
      expect(segment.includes("do-resolve(txn.dst,buildcage,ipv4) req.hdr(host)")).toBe(true);
    }
    expect(resolvConf.includes("tcp-request content do-resolve(txn.dst,buildcage,ipv4)")).toBe(
      true,
    );
  });

  it("retries a resolution once, still exempting an address and a hit", () => {
    // A failed resolution is not cached, so the second call is a fresh attempt.
    // Dropping either guard would resolve a literal address or overwrite a
    // destination the first call already found.
    for (const frontend of ["https_in", "http_in"]) {
      const resolves = frontendSegment(FULL_CONFIG, frontend)
        .split("\n")
        .filter((l) => l.includes("do-resolve(txn.dst,buildcage,ipv4) req.hdr(host)"));
      expect(resolves.length).toBe(2);
      expect(resolves[1].endsWith("unless host_is_address or { var(txn.dst) -m found }")).toBe(
        true,
      );
    }
  });

  it("supports more than one upstream nameserver, not just the first", () => {
    expect(FULL_CONFIG.includes("nameserver ns1 1.1.1.1:53")).toBe(true);
    expect(FULL_CONFIG.includes("nameserver ns2 8.8.8.8:53")).toBe(true);
  });

  it("accepts an answer past the 512-byte default, which would resolve nothing", () => {
    // An internal zone often serves enough records to pass it, and a
    // truncated answer is no answer at all.
    expect(FULL_CONFIG.includes("    accepted_payload_size 8192")).toBe(true);
  });

  it("falls back to the container's own resolv.conf, not a public resolver", () => {
    const resolvConf = gen({ ...FULL, resolverAddress: [], useResolvConf: true });
    expect(resolvConf.includes("    parse-resolv-conf")).toBe(true);
    expect(resolvConf.includes("nameserver ns1")).toBe(false);
  });

  it("prefers named upstreams over resolv.conf when both are given", () => {
    const both = gen({ ...FULL, useResolvConf: true });
    expect(both.includes("nameserver ns1 1.1.1.1:53")).toBe(true);
    expect(both.includes("parse-resolv-conf")).toBe(false);
  });

  it("refuses to resolve through resolv.conf without the proxy's own address", () => {
    // The internal-address guard is built from proxyAddress, so resolving
    // without one has to fail closed.
    expect(() =>
      generateHaproxyConfig({
        ...FULL,
        resolverAddress: [],
        proxyAddress: undefined,
        useResolvConf: true,
      }),
    ).toThrow(/proxyAddress is required/);
  });
});

describe("the internal-address guard", () => {
  it("refuses a resolved destination that lands on an internal address", () => {
    // The rules check the name; nothing checks where it resolves. A name that
    // resolves to cloud metadata or the proxy itself would otherwise have the
    // proxy connect there from its own network position. Confirmed against a
    // build: an allowlisted name pointing at 169.254.169.254 reached it.
    expect(
      FULL_CONFIG.includes(
        "acl dst_internal var(txn.dst) -m ip 0.0.0.0/8 127.0.0.0/8 169.254.0.0/16",
      ),
    ).toBe(true);
    expect(
      FULL_CONFIG.includes("http-request deny deny_status 403 if dst_internal !host_is_address"),
    ).toBe(true);
  });

  it("includes the proxy's own address in the internal set, against a loop", () => {
    // gateway.example.com -> 172.20.0.1 (the proxy) made it connect to itself.
    const acl = FULL_CONFIG.split("\n").find((l) => l.includes("acl dst_internal"))!;
    expect(acl.trim().endsWith("172.20.0.1")).toBe(true);
  });

  it("extends the internal set with the runner's own addresses, as a second acl of the same name", () => {
    // RFC1918 is allowed on purpose for an internal mirror, so without this an
    // allowlisted name resolving to the runner reaches its published ports.
    // A file, not more words: HAProxy truncates a long acl line silently.
    const withHost = gen({ ...FULL, hostAddressFile: "/etc/haproxy/rules/host_addrs.lst" });
    const guards = withHost
      .split("\n")
      .filter(
        (l) =>
          l.trim().startsWith("acl dst_internal ") || l.trim().startsWith("acl pass_dst_internal "),
      );
    // Three guard sites: the passthrough path and both inspected stages.
    expect(guards.length).toBe(6);
    const byFile = guards.filter((l) => l.includes("-m ip -f /etc/haproxy/rules/host_addrs.lst"));
    expect(byFile.length).toBe(3);
    // Both declarations of a name must judge the same sample to OR meaningfully.
    for (const line of guards) expect(line.includes("var(txn.dst)")).toBe(true);
  });

  it("emits no host-address acl when no file is given, rather than an unreadable path", () => {
    // The universal engine's own template carries the equivalent line; this
    // generator is only ever called by init-inspect-cfg, which always writes
    // the file, so an absent path means the two are out of step.
    expect(FULL_CONFIG.includes("-m ip -f")).toBe(false);
  });

  it("exempts an explicitly-named address, which was asked for, not arrived at", () => {
    // allowed_ip_rules and an address in allowed_url_rules stay reachable.
    expect(FULL_CONFIG.includes("if dst_internal !host_is_address")).toBe(true);
  });

  it("guards the passthrough path too, where the rules cannot run", () => {
    const withTls = gen({ ...FULL });
    expect(withTls.includes("acl pass_dst_internal var(txn.dst) -m ip")).toBe(true);
    expect(
      withTls.includes(
        "tcp-request content reject if { var(txn.tlsrule) -m found } pass_dst_internal",
      ),
    ).toBe(true);
  });

  it("does not fold the upstream resolvers into the internal-address guard", () => {
    // resolverAddress names real, external nameservers, not the gateway;
    // conflating the two would make a rule resolving to 1.1.1.1 unreachable
    // and, worse, would have masked a resolved destination actually landing
    // on the proxy's own address.
    const acl = FULL_CONFIG.split("\n").find((l) => l.includes("acl dst_internal"))!;
    expect(acl.includes("1.1.1.1")).toBe(false);
    expect(acl.includes("8.8.8.8")).toBe(false);
    expect(acl.trim().endsWith("172.20.0.1")).toBe(true);
  });
});

describe("what a log line records", () => {
  it("records the path in a form that does not depend on the HTTP version", () => {
    // %HU is the request target as sent: a path over HTTP/1.1, an absolute URI
    // over HTTP/2, which every TLS client negotiates by default.
    expect(FULL_CONFIG.includes("%[capture.req.hdr(0)]%HU")).toBe(false);
    expect(FULL_CONFIG.includes("%[capture.req.hdr(0)]%[var(txn.pathq)]")).toBe(true);
    expect(FULL_CONFIG.includes("http-request set-var(txn.pathq) 'pathq,regsub(")).toBe(true);
  });

  it("sizes a log line for the longest request it accepts", () => {
    // A cut line matches nothing, so the event it carried leaves no trace. The
    // token order is load-bearing: the other one is rejected outright.
    expect(FULL_CONFIG.includes("log stdout len 16384 format raw local0")).toBe(true);
  });

  it("puts the one field the build sizes at the end of every line it logs", () => {
    // Whatever cuts a line then costs a URL's tail, not the decision.
    const formats = FULL_CONFIG.split("\n").filter((line) =>
      line.includes('log-format "buildcage'),
    );
    expect(formats.length).toBe(3);
    expect(
      formats.every(
        (line) => line.endsWith('%[var(txn.pathq)]"') || line.endsWith('sni=%[var(txn.sni)]"'),
      ),
    ).toBe(true);
  });

  it("records a passthrough's name, size and destination, its only trace", () => {
    // Nothing decrypts one, so there is no request line to fall back on.
    expect(
      FULL_CONFIG.includes(
        'log-format "buildcage %[date(0,ms)] pass %[var(txn.proto)] %B ts=%ts ' +
          'reason=%[var(txn.reason)] dst=%[dst]:%[dst_port] sni=%[var(txn.sni)]"',
      ),
    ).toBe(true);
  });

  it("strips whitespace, quotes and control chars from the Host header and the path before logging them", () => {
    // Both are attacker-controlled; ACL matching still runs on the untouched
    // req.hdr(host)/path fetches; only the logged copies are sanitized. Unlike
    // the SNI below, the Host header legitimately carries its own ":port", so
    // it can't be reduced to a hostname charset: only the actually unsafe
    // characters are stripped.
    expect(
      FULL_CONFIG.includes(
        `http-request capture 'req.hdr(host),regsub("[\\s\\"[:cntrl:]]",_,g)' len 100`,
      ),
    ).toBe(true);
    expect(
      FULL_CONFIG.includes(`http-request set-var(txn.pathq) 'pathq,regsub("[\\"[:cntrl:]]",_,g)'`),
    ).toBe(true);
  });

  it("leaves a non-default port's ':' untouched in the Host capture", () => {
    // The Host capture must not be reduced to the SNI's hostname-only charset:
    // that also eats the ':' a Host header carries for a non-default port,
    // turning "allowed.example.com:9443" into "allowed.example.com_9443" in the
    // report. This mirrors HAProxy's own regsub("[\s\"[:cntrl:]]",_,g) against
    // a POSIX/PCRE2-equivalent pattern.
    const stripped = "allowed.example.com:9443".replace(/[\s"\p{Cc}]/gu, "_");
    expect(stripped).toBe("allowed.example.com:9443");
  });

  it("records the path after normalizing it, not as it was sent", () => {
    const normalise = FULL_CONFIG.indexOf("normalize-uri path-strip-dotdot");
    const capture = FULL_CONFIG.indexOf("set-var(txn.pathq)");
    expect(normalise !== -1 && normalise < capture).toBe(true);
  });

  it("records the path before refusing a traversal, not after", () => {
    // Denying first leaves txn.pathq unset, so the log shows a bare host and
    // the report loses the URL of exactly the requests worth seeing.
    const capture = FULL_CONFIG.indexOf("set-var(txn.pathq)");
    const deny = FULL_CONFIG.indexOf("deny deny_status 403 if { path -m reg");
    expect(capture !== -1 && capture < deny).toBe(true);
  });
});

describe("the path the rules see", () => {
  it("decodes before stripping dot-dots, not after", () => {
    // `.` is unreserved, so `%2e%2e` is not a dot-dot segment until it has been
    // decoded. Stripping first leaves it intact, the rules see a path that
    // never leaves /public/, and the origin resolves it somewhere else.
    // Verified against a real build: it returned PRIVATE with a 200.
    const decode = FULL_CONFIG.indexOf("normalize-uri percent-decode-unreserved");
    const strip = FULL_CONFIG.indexOf("normalize-uri path-strip-dotdot");
    expect(decode !== -1 && decode < strip).toBe(true);
  });

  it("refuses a dot-dot beside an encoded slash or backslash", () => {
    // `/` and `\\` are both separators an origin may honour: `%2f` is reserved
    // so it survives decoding, and the URL standard treats `\\` as `/` for
    // http(s). Neither is a segment HAProxy strips, so `..` beside either is
    // refused. An encoded separator on its own stays legitimate.
    expect(
      FULL_CONFIG.includes(
        "http-request deny deny_status 403 if { path -m reg -i (^|/|%2f|%5c)\\.\\.($|/|%2f|%5c) }",
      ),
    ).toBe(true);
  });

  it("refuses a raw backslash outright, it being no valid path character", () => {
    // RFC 3986 does not allow it unencoded; its only use is as a separator on
    // the origins that accept it. `\\\\` in the source is `\\` in the generated config,
    // which HAProxy's parser reads as one literal backslash.
    expect(FULL_CONFIG.includes("http-request deny deny_status 403 if { path -m sub \\\\ }")).toBe(
      true,
    );
  });

  it("resolves `..` before the rules look at the path", () => {
    const normalise = FULL_CONFIG.indexOf("normalize-uri path-strip-dotdot");
    const firstRule = FULL_CONFIG.indexOf("set-var(txn.allowed) bool(true)");
    expect(normalise !== -1 && normalise < firstRule).toBe(true);
  });
});

describe("TLS to the origin", () => {
  it("checks the origin certificate on the only path that reaches it", () => {
    expect(
      FULL_CONFIG.includes("ssl verify required ca-file /etc/ssl/certs/ca-certificates.crt"),
    ).toBe(true);
  });

  it("bases generated certificates on a template, not on the CA itself", () => {
    // Pointing the default at the CA makes the first handshake per name fail.
    expect(FULL_CONFIG.includes("ssl crt /etc/haproxy/default.pem generate-certificates")).toBe(
      true,
    );
    expect(FULL_CONFIG.includes("ca-sign-file /etc/haproxy/ca.pem")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// HAProxy truncates a line past MAX_LINE_ARGS words without saying so, so no
// rule count may push one over.
// ---------------------------------------------------------------------------
describe("line length", () => {
  it("decides with one line per rule, which no rule count can outgrow", () => {
    const rules = Array.from({ length: 40 }, (_, i) => `GET https://h${i}.example.com/pkg/**`);
    const config = gen({ urlRules: buildUrlRules(rules.join("\n")) });
    expect(config.includes("-m bool } s39_host")).toBe(true);
    expect(longestLineWords(config) <= MAX_LINE_WORDS).toBe(true);
  });

  it("flags a passthrough with one line per rule, which no rule count can outgrow", () => {
    const config = gen({
      tlsRules: Array.from({ length: 30 }, (_, i) => `h${i}.example.com:443`),
      ipRules: Array.from({ length: 30 }, (_, i) => `10.0.0.${i}:5432`),
    });
    expect(config.includes("set-var(txn.pass) int(1) if tls29_sni tls29_port")).toBe(true);
    expect(longestLineWords(config) <= MAX_LINE_WORDS).toBe(true);
  });

  it("keeps the internal guard off the line-length cliff however many host addresses there are", () => {
    // The point of the pattern file: addresses live in it, not on the acl line.
    const withHost = gen({ ...FULL, hostAddressFile: "/etc/haproxy/rules/host_addrs.lst" });
    expect(longestLineWords(withHost) <= MAX_LINE_WORDS).toBe(true);
  });
});

describe("rules that cannot be honoured", () => {
  it("refuses an address pattern rather than approximating a range", () => {
    const result = generateHaproxyConfig({ ipRules: ["10.0.0.*:5432"] });
    expect(result.warnings.length).toBe(1);
    expect(result.config.includes("ip0_dst")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// audit records without enforcing, so it may not refuse anything
// ---------------------------------------------------------------------------
describe("audit mode", () => {
  const audit = gen({ ...FULL, mode: "audit" });

  it("refuses nothing on either listener", () => {
    expect(audit.includes("http-request deny unless")).toBe(false);
    expect(audit.includes("# No rules for this scheme")).toBe(false);
  });

  it("still records the time, the method and the full URL", () => {
    expect(audit.includes('log-format "buildcage %[date(0,ms)] https %HM %ST %B ts=%ts')).toBe(
      true,
    );
    expect(audit.includes('log-format "buildcage %[date(0,ms)] http %HM %ST %B ts=%ts')).toBe(true);
    expect(audit.includes("https://%[capture.req.hdr(0)]%[var(txn.pathq)]")).toBe(true);
  });

  it("still connects only where it resolved the name", () => {
    expect(audit.includes("http-request set-dst var(txn.dst)")).toBe(true);
  });

  it("still resolves for a scheme with no rules, having denied nothing above", () => {
    // Only restrict's unconditional deny makes the rest of a stage dead; audit
    // refuses nothing, so a scheme with no rules still needs the resolver.
    const plain = frontendSegment(gen({ ...FULL, mode: "audit", httpRules: [] }), "http_in");
    expect(plain.includes("do-resolve(txn.dst,buildcage,ipv4) req.hdr(host)")).toBe(true);
  });

  it("still checks the origin certificate", () => {
    expect(audit.includes("ssl verify required")).toBe(true);
  });
});

reportResults();

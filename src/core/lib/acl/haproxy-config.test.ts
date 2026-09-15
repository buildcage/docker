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

// ---------------------------------------------------------------------------
// Each of these still lets ordinary traffic through when omitted, so none can
// be caught by testing the happy path.
// ---------------------------------------------------------------------------
describe("load-bearing directives", () => {
  const config = gen(FULL);

  it("exposes readiness on a unix socket, out of reach of the firewall", () => {
    // s6-notifyoncheck polls this; a TCP health port would depend on what
    // init-iptables allows, and a blocked check never signals ready.
    const health = frontendSegment(config, "health");
    expect(health.includes("bind /var/run/haproxy-health.sock mode 666")).toBe(true);
    expect(health.includes("monitor-uri /health")).toBe(true);
  });

  it("drops to an unprivileged user", () => {
    expect(config.includes("\n    user haproxy\n")).toBe(true);
    expect(config.includes("\n    group haproxy\n")).toBe(true);
  });

  it("states the resolver's address family, leaving it nothing to read off the host", () => {
    expect(config.includes("\n    dns-accept-family ipv4\n")).toBe(true);
    // A do-resolve asking for a family the global setting never queries comes
    // back with nothing, so the two have to agree.
    const resolves = config.split("\n").filter((l) => l.includes("do-resolve("));
    expect(resolves.length > 0).toBe(true);
    expect(resolves.every((l) => l.includes(",ipv4)"))).toBe(true);
  });

  it("classifies by the first bytes, so no port is declared in advance", () => {
    // This is what lets audit record everything without being configured.
    expect(config.includes("acl is_tls req.ssl_hello_type 1")).toBe(true);
    expect(config.includes("use_backend to_tls if is_tls")).toBe(true);
  });

  it("connects where it resolved the name, not where the client aimed", () => {
    // Removes the forged-Host class of attack rather than detecting it.
    expect(
      config.includes(
        "http-request do-resolve(txn.dst,buildcage,ipv4) req.hdr(host),lower,host_only",
      ),
    ).toBe(true);
    expect(config.includes("http-request set-dst var(txn.dst)")).toBe(true);
  });

  it("strips the port before resolving, so a non-default port still resolves", () => {
    // A Host header carries the port for a non-default port. Resolving the
    // whole "name:port" string matches no allowlist entry, so the request is
    // answered with the proxy's own address and reaches nothing.
    expect(
      config.includes("do-resolve(txn.dst,buildcage,ipv4) req.hdr(host),lower,host_only"),
    ).toBe(true);
    // An SNI is a name, never a name and a port, and the origin certificate is
    // verified against it.
    expect(config.includes("sni req.hdr(host),lower,host_only")).toBe(true);
  });

  it("takes an address in the Host header as it stands, asking no resolver", () => {
    // No resolver can answer an address, so asking would fail and refuse the
    // request, leaving a rule that names an address impossible to satisfy.
    expect(
      config.includes("acl host_is_address req.hdr(host),host_only,regsub(\\.$,) -m reg ^(25[0-5]"),
    ).toBe(true);
    expect(
      config.includes(
        "http-request set-var(txn.dst) req.hdr(host),host_only,regsub(\\.$,) if host_is_address",
      ),
    ).toBe(true);
    expect(
      config.includes("req.hdr(host),lower,host_only,regsub(\\.$,) unless host_is_address"),
    ).toBe(true);
  });

  it("is strict about the octets, since what matches is never checked again", () => {
    // Whatever the pattern admits goes to set-dst unresolved. 999.1.2.3,
    // 010.0.0.1 and 1.2.3.4.evil.example must all fail it and fall through to
    // the resolver, which cannot answer them either.
    const acl = config.split("\n").find((l) => l.includes("acl host_is_address"))!;
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
      config.includes("http-request deny deny_status 502 unless { var(txn.dst) -m found }"),
    ).toBe(true);
  });

  it("records the path in a form that does not depend on the HTTP version", () => {
    // %HU is the request target as sent: a path over HTTP/1.1, an absolute URI
    // over HTTP/2, which every TLS client negotiates by default.
    expect(config.includes("%[capture.req.hdr(0)]%HU")).toBe(false);
    expect(config.includes("%[capture.req.hdr(0)]%[var(txn.pathq)]")).toBe(true);
    expect(config.includes("http-request set-var(txn.pathq) 'pathq,regsub(")).toBe(true);
  });

  it("sizes a log line for the longest request it accepts", () => {
    // A cut line matches nothing, so the event it carried leaves no trace. The
    // token order is load-bearing: the other one is rejected outright.
    expect(config.includes("log stdout len 16384 format raw local0")).toBe(true);
  });

  it("puts the one field the build sizes at the end of every line it logs", () => {
    // Whatever cuts a line then costs a URL's tail, not the decision.
    const formats = config.split("\n").filter((line) => line.includes('log-format "buildcage'));
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
      config.includes(
        'log-format "buildcage %[date(0,ms)] pass %[var(txn.proto)] %B ts=%ts ' +
          'reason=%[var(txn.reason)] dst=%[dst]:%[dst_port] sni=%[var(txn.sni)]"',
      ),
    ).toBe(true);
  });

  it("strips whitespace, quotes and control chars from the Host header and the path before logging them", () => {
    // Both are attacker-controlled; ACL matching still runs on the untouched
    // req.hdr(host)/path fetches, only the logged copies are sanitized. Unlike
    // the SNI below, the Host header legitimately carries its own ":port", so
    // it can't be reduced to a hostname charset -- only the actually unsafe
    // characters are stripped.
    expect(
      config.includes(
        `http-request capture 'req.hdr(host),regsub("[\\s\\"[:cntrl:]]",_,g)' len 100`,
      ),
    ).toBe(true);
    expect(
      config.includes(`http-request set-var(txn.pathq) 'pathq,regsub("[\\"[:cntrl:]]",_,g)'`),
    ).toBe(true);
  });

  it("the Host-capture charset leaves a non-default port's ':' untouched", () => {
    // Regression: an earlier version reduced the Host capture to the SNI's
    // hostname-only charset, which also ate the ':' a Host header carries for
    // a non-default port -- turning "allowed.example.com:9443" into
    // "allowed.example.com_9443" in the report. This mirrors HAProxy's own
    // regsub("[\s\"[:cntrl:]]",_,g) against a POSIX/PCRE2-equivalent pattern.
    const stripped = "allowed.example.com:9443".replace(/[\s"\p{Cc}]/gu, "_");
    expect(stripped).toBe("allowed.example.com:9443");
  });

  it("records the path after normalising it, not as it was sent", () => {
    const normalise = config.indexOf("normalize-uri path-strip-dotdot");
    const capture = config.indexOf("set-var(txn.pathq)");
    expect(normalise !== -1 && normalise < capture).toBe(true);
  });

  it("decodes before stripping dot-dots, not after", () => {
    // `.` is unreserved, so `%2e%2e` is not a dot-dot segment until it has been
    // decoded. Stripping first leaves it intact, the rules see a path that
    // never leaves /public/, and the origin resolves it somewhere else.
    // Verified against a real build: it returned PRIVATE with a 200.
    const decode = config.indexOf("normalize-uri percent-decode-unreserved");
    const strip = config.indexOf("normalize-uri path-strip-dotdot");
    expect(decode !== -1 && decode < strip).toBe(true);
  });

  it("records the path before refusing a traversal, not after", () => {
    // Denying first leaves txn.pathq unset, so the log shows a bare host and
    // the report loses the URL of exactly the requests worth seeing.
    const capture = config.indexOf("set-var(txn.pathq)");
    const deny = config.indexOf("deny deny_status 403 if { path -m reg");
    expect(capture !== -1 && capture < deny).toBe(true);
  });

  it("refuses a dot-dot beside an encoded slash or backslash", () => {
    // `/` and `\\` are both separators an origin may honour: `%2f` is reserved
    // so it survives decoding, and the URL standard treats `\\` as `/` for
    // http(s). Neither is a segment HAProxy strips, so `..` beside either is
    // refused. An encoded separator on its own stays legitimate.
    expect(
      config.includes(
        "http-request deny deny_status 403 if { path -m reg -i (^|/|%2f|%5c)\\.\\.($|/|%2f|%5c) }",
      ),
    ).toBe(true);
  });

  it("refuses a raw backslash outright, it being no valid path character", () => {
    // RFC 3986 does not allow it unencoded; its only use is as a separator on
    // the origins that accept it. `\\\\` in the source is `\\` in the config,
    // which HAProxy's parser reads as one literal backslash.
    expect(config.includes("http-request deny deny_status 403 if { path -m sub \\\\ }")).toBe(true);
  });

  it("resolves `..` before the rules look at the path", () => {
    const normalise = config.indexOf("normalize-uri path-strip-dotdot");
    const firstRule = config.indexOf("set-var(txn.allowed) bool(true)");
    expect(normalise !== -1 && normalise < firstRule).toBe(true);
  });

  it("refuses a resolved destination that lands on an internal address", () => {
    // The rules check the name; nothing checks where it resolves. A name that
    // resolves to cloud metadata or the proxy itself would otherwise have the
    // proxy connect there from its own network position. Confirmed against a
    // build: an allowlisted name pointing at 169.254.169.254 reached it.
    expect(
      config.includes("acl dst_internal var(txn.dst) -m ip 0.0.0.0/8 127.0.0.0/8 169.254.0.0/16"),
    ).toBe(true);
    expect(
      config.includes("http-request deny deny_status 403 if dst_internal !host_is_address"),
    ).toBe(true);
  });

  it("includes the proxy's own address in the internal set, against a loop", () => {
    // gateway.example.com -> 172.20.0.1 (the proxy) made it connect to itself.
    const acl = config.split("\n").find((l) => l.includes("acl dst_internal"))!;
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
    expect(config.includes("-m ip -f")).toBe(false);
  });

  it("exempts an explicitly-named address, which was asked for not arrived at", () => {
    // allowed_ip_rules and an address in allowed_url_rules stay reachable.
    expect(config.includes("if dst_internal !host_is_address")).toBe(true);
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

  it("checks the origin certificate on the only path that reaches it", () => {
    expect(config.includes("ssl verify required ca-file /etc/ssl/certs/ca-certificates.crt")).toBe(
      true,
    );
  });

  it("bases generated certificates on a template, not on the CA itself", () => {
    // Pointing the default at the CA makes the first handshake per name fail.
    expect(config.includes("ssl crt /etc/haproxy/default.pem generate-certificates")).toBe(true);
    expect(config.includes("ca-sign-file /etc/haproxy/ca.pem")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// This resolver is the only place a real DNS query leaves the proxy: CoreDNS
// never forwards, even for an allowed name (see coredns-config.ts). A request
// that the rules would deny must never reach do-resolve, or the real upstream
// sees a query for a name the rules never granted -- the exact channel this
// design exists to close.
// ---------------------------------------------------------------------------
describe("resolves only once a request already passed the rules", () => {
  const config = gen(FULL);

  it("denies on host, path and method before resolving, on both listeners", () => {
    for (const frontend of ["https_in", "http_in"]) {
      const segment = frontendSegment(config, frontend);
      const firstRule = segment.indexOf("set-var(txn.allowed) bool(true)");
      const deny = segment.indexOf("http-request deny unless");
      const resolve = segment.indexOf("do-resolve(txn.dst,buildcage,ipv4) req.hdr(host)");
      expect(firstRule).not.toBe(-1);
      expect(resolve).not.toBe(-1);
      expect(firstRule < deny && deny < resolve).toBe(true);
    }
  });

  it("retries a resolution once, still exempting an address and a hit", () => {
    // A failed resolution is not cached, so the second call is a fresh attempt.
    // Dropping either guard would resolve a literal address or overwrite a
    // destination the first call already found.
    for (const frontend of ["https_in", "http_in"]) {
      const resolves = frontendSegment(config, frontend)
        .split("\n")
        .filter((l) => l.includes("do-resolve(txn.dst,buildcage,ipv4) req.hdr(host)"));
      expect(resolves.length).toBe(2);
      expect(resolves[1].endsWith("unless host_is_address or { var(txn.dst) -m found }")).toBe(
        true,
      );
    }
  });

  it("supports more than one upstream nameserver, not just the first", () => {
    expect(config.includes("nameserver ns1 1.1.1.1:53")).toBe(true);
    expect(config.includes("nameserver ns2 8.8.8.8:53")).toBe(true);
  });

  it("accepts an answer past the 512-byte default, which would resolve nothing", () => {
    // An internal zone often serves enough records to pass it, and a
    // truncated answer is no answer at all.
    expect(config.includes("    accepted_payload_size 8192")).toBe(true);
  });

  it("falls back to the container's own resolv.conf, not a public resolver", () => {
    const resolvConf = gen({ ...FULL, resolverAddress: [], useResolvConf: true });
    expect(resolvConf.includes("    parse-resolv-conf")).toBe(true);
    expect(resolvConf.includes("nameserver ns1")).toBe(false);
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

  it("sets the resolved destination before the internal-address check, not after", () => {
    // %[dst] in the log-format reads whatever set-dst last wrote. CoreDNS
    // never hands the build a real address (see coredns-config.ts), so a
    // refusal logged before set-dst ran would show the build's own fake
    // destination instead of the real one that tripped the guard -- silently
    // losing exactly the forensic value an SSRF refusal exists to keep.
    for (const frontend of ["https_in", "http_in"]) {
      const segment = frontendSegment(config, frontend);
      const setDst = segment.indexOf("http-request set-dst var(txn.dst)");
      const internalDeny = segment.indexOf("deny deny_status 403 if dst_internal");
      expect(setDst).not.toBe(-1);
      expect(internalDeny).not.toBe(-1);
      expect(setDst < internalDeny).toBe(true);
    }
  });

  it("does the same for a passthrough, which logs its own destination too", () => {
    const setDst = config.indexOf("tcp-request content set-dst var(txn.dst)");
    const internalReject = config.indexOf(
      "reject if { var(txn.tlsrule) -m found } pass_dst_internal",
    );
    expect(setDst).not.toBe(-1);
    expect(internalReject).not.toBe(-1);
    expect(setDst < internalReject).toBe(true);
  });

  it("gates the passthrough's do-resolve on the same SNI match that admits it", () => {
    // Not just ordering: a passthrough rule has no path or method, so this
    // flag -- set only when an SNI already matched -- is the entire rule
    // check do-resolve sits behind. A request no rule admits must never
    // reach it, same invariant as the host+path+method check above.
    const tlsRuleSet = config.indexOf("set-var(txn.tlsrule)");
    const resolveLine = config
      .split("\n")
      .find((l) => l.includes("do-resolve(txn.dst,buildcage,ipv4) req.ssl_sni"))!;
    const resolve = config.indexOf(resolveLine);
    expect(tlsRuleSet).not.toBe(-1);
    expect(resolveLine).toBeTruthy();
    expect(tlsRuleSet < resolve).toBe(true);
    expect(resolveLine.includes("if { var(txn.tlsrule) -m found }")).toBe(true);
  });

  it("does not fold the upstream resolvers into the internal-address guard", () => {
    // resolverAddress now names real, external nameservers, not the gateway;
    // conflating the two would make a rule resolving to 1.1.1.1 unreachable
    // and, worse, would have masked a resolved destination actually landing
    // on the proxy's own address.
    const acl = config.split("\n").find((l) => l.includes("acl dst_internal"))!;
    expect(acl.includes("1.1.1.1")).toBe(false);
    expect(acl.includes("8.8.8.8")).toBe(false);
    expect(acl.trim().endsWith("172.20.0.1")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------
describe("rules", () => {
  it("matches a host case-insensitively, as a name is", () => {
    // do-resolve already lowercases the name it looks up, so a case-sensitive
    // acl refuses `Host: Registry.NPMJS.org` despite an explicit allow rule.
    // The header is lowercased once, so the literal pattern must be lowercase
    // and a pattern that stays a regex keeps -i.
    const literal = gen({ httpsRules: ["A.com:443"] });
    expect(literal.includes("set-var(txn.host) hdr(host),lower,host_only")).toBe(true);
    expect(literal.includes("acl s0_host var(txn.host) -m str a.com")).toBe(true);
    expect(gen({ httpsRules: ["*.a.com:443"] }).includes("-m reg -i ^[^.]+\\\\.a\\\\.com$")).toBe(
      true,
    );
  });

  it("strips a trailing dot from the Host header before matching, resolving or verifying it", () => {
    // "a.com." is the same DNS name as "a.com" (RFC 1035), and some tools
    // write it that way to skip resolv.conf's search-list expansion. Without
    // this, `Host: a.com.` would refuse an explicit allow rule for a.com.
    const config = gen({ httpsRules: ["a.com:443"] });
    expect(
      config.includes("http-request set-var(txn.host) hdr(host),lower,host_only,regsub(\\.$,)"),
    ).toBe(true);
  });

  it("reads the Host header once, however many rules are matched against it", () => {
    // Every rule used to re-run the fetch and its regsub. The cost of that is
    // paid per rule per request, and rule sets have no size limit.
    const config = gen({
      urlRules: buildUrlRules(
        Array.from({ length: 8 }, (_, i) => `GET https://h${i}.com/x`).join("\n"),
      ),
    });
    const segment = frontendSegment(config, "https_in");
    expect(segment.split("hdr(host),lower,host_only").length - 1).toBe(1);
    expect(segment.includes("acl s7_host var(txn.host) -m str h7.com")).toBe(true);
  });

  it("matches a literal name as a string and only a wildcard as a regex", () => {
    // An anchored regex over a literal name only ever matches that one name,
    // so the regex engine has nothing to decide.
    expect(
      gen({ httpsRules: ["a.com:443"] }).includes("acl s0_host var(txn.host) -m str a.com"),
    ).toBe(true);
    expect(
      gen({ httpsRules: ["*.a.com:443"] }).includes(
        "acl s0_host var(txn.host) -m reg -i ^[^.]+\\\\.a\\\\.com$",
      ),
    ).toBe(true);
  });

  it("matches a literal path as a string and a prefix path as a prefix", () => {
    const exact = gen({ urlRules: buildUrlRules("GET https://a.com/pkg.json") });
    expect(exact.includes("acl s0_path path -m str /pkg.json")).toBe(true);
    const prefix = gen({ urlRules: buildUrlRules("GET https://a.com/pkg/**") });
    expect(prefix.includes("acl s0_path path -m beg /pkg/")).toBe(true);
    // A single-segment wildcard is not a prefix: /pkg/a/b must stay refused.
    const segment = gen({ urlRules: buildUrlRules("GET https://a.com/pkg/*") });
    expect(segment.includes("acl s0_path path -m reg ^/pkg/[^/]+$")).toBe(true);
  });

  it("treats both spellings of an any-path rule as the same prefix", () => {
    // A host rule compiles to `^/` and `/**` to `^/.*$`; both permit any path,
    // and both still require the leading slash an `OPTIONS *` target lacks.
    expect(gen({ httpsRules: ["a.com:443"] }).includes("acl s0_path path -m beg /")).toBe(true);
    expect(
      gen({ urlRules: buildUrlRules("GET https://a.com/**") }).includes(
        "acl s0_path path -m beg /",
      ),
    ).toBe(true);
  });

  it("leaves a ~rule's own regex alone, quantifiers included", () => {
    // `/a+` is one or more `a` to the author. Read as a literal it would allow
    // only the path `/a+`, and `^/v+/x.*$` as a prefix would allow that same
    // literal `+` past a rule that never permitted it.
    const plus = gen({ urlRules: buildUrlRules("GET ~^https://a\\.com/a+$") });
    expect(plus.includes("acl s0_path path -m reg ^/a+$")).toBe(true);
    const prefix = gen({ urlRules: buildUrlRules("GET ~^https://a\\.com/v+/x.*$") });
    expect(prefix.includes("acl s0_path path -m reg ^/v+/x.*$")).toBe(true);
  });

  it("names the host variable only where a rule reads it", () => {
    // A ~rule matches its own host variable, so a rule set made only of them
    // would pay for a fetch and a regsub per request that nothing reads.
    const regexOnly = gen({ httpsRules: ["~^a\\.com:(443|8443)$"] });
    expect(regexOnly.includes("set-var(txn.host)")).toBe(false);
    expect(gen({ httpsRules: ["a.com:443"] }).includes("set-var(txn.host)")).toBe(true);
  });

  it("matches a name once for every rule that names it", () => {
    const config = gen({
      urlRules: buildUrlRules("GET https://a.com/one/**\nGET https://a.com/two/**"),
    });
    expect(config.includes("acl s1_host")).toBe(false);
    expect(
      config.includes(
        "bool(true) if !{ var(txn.allowed) -m bool } s0_host s1_port s1_path s1_method",
      ),
    ).toBe(true);
  });

  it("stops matching once a rule has allowed the request", () => {
    // Without the flag first, every later rule still runs its own matching on
    // a request that is already allowed.
    const config = gen({
      urlRules: buildUrlRules("GET https://a.com/x\nGET https://b.com/y"),
    });
    expect(
      config.includes(
        "set-var(txn.allowed) bool(true) if !{ var(txn.allowed) -m bool } s1_host s1_port s1_path s1_method",
      ),
    ).toBe(true);
  });

  it("takes the port from the connection, not from the Host header", () => {
    // A Host header omits the port only for a default one, so a matcher built
    // from it has to accept the port being absent -- which made a rule for
    // :9443 also permit :443 on the same host. Found by the round-trip test.
    const config = gen({ urlRules: buildUrlRules("GET https://a.com:9443/private/x") });
    expect(config.includes("acl s0_host var(txn.host) -m str a.com")).toBe(true);
    expect(config.includes("acl s0_port dst_port 9443")).toBe(true);
    expect(config.includes("(:9443)?")).toBe(false);
    expect(
      config.includes(
        "bool(true) if !{ var(txn.allowed) -m bool } s0_host s0_port s0_path s0_method",
      ),
    ).toBe(true);
  });

  it("gives a host rule the same treatment", () => {
    const config = gen({ httpsRules: ["a.com:8443"] });
    expect(config.includes("acl s0_host var(txn.host) -m str a.com")).toBe(true);
    expect(config.includes("acl s0_port dst_port 8443")).toBe(true);
  });

  it("matches a ~regex host rule's host and port as one expression", () => {
    const config = gen({ httpsRules: ["~^.*\\.example\\.com:(443|8443)$"] });
    expect(
      config.includes(
        "set-var-fmt(txn.host_port) %[hdr(host),host_only,regsub(\\.$,)]:%[dst_port]",
      ),
    ).toBe(true);
    expect(
      config.includes(
        "acl s0_host var(txn.host_port) -m reg -i ^.*\\\\.example\\\\.com:(443|8443)$",
      ),
    ).toBe(true);
    // The pattern's own port coverage replaces dst_port entirely.
    expect(config.includes("s0_port")).toBe(false);
    expect(config.includes("bool(true) if !{ var(txn.allowed) -m bool } s0_host s0_path")).toBe(
      true,
    );
  });

  it("omits the port acl only when the rule names every port", () => {
    const config = gen({ httpsRules: ["a.com:*"] });
    expect(config.includes("s0_port")).toBe(false);
    expect(config.includes("bool(true) if !{ var(txn.allowed) -m bool } s0_host s0_path")).toBe(
      true,
    );
  });

  it("matches the host and the path separately", () => {
    const config = gen({ urlRules: buildUrlRules("GET https://a.com/pub/**") });
    expect(config.includes("acl s0_host var(txn.host) -m str a.com")).toBe(true);
    expect(config.includes("acl s0_path path -m beg /pub/")).toBe(true);
    expect(config.includes("acl s0_method method GET")).toBe(true);
    expect(
      config.includes(
        "bool(true) if !{ var(txn.allowed) -m bool } s0_host s0_port s0_path s0_method",
      ),
    ).toBe(true);
  });

  it("accepts a Host header with or without the port, since only the name is compared", () => {
    const config = gen({ httpsRules: ["a.com:443"] });
    expect(config.includes("acl s0_host var(txn.host) -m str a.com")).toBe(true);
    expect(config.includes("acl s0_port dst_port 443")).toBe(true);
  });

  it("lets a host rule permit any path", () => {
    const config = gen({ httpsRules: ["a.com:443"] });
    expect(config.includes("acl s0_path path -m beg /")).toBe(true);
    expect(config.includes("s0_method")).toBe(false);
  });

  it("splits rules by scheme, since the two arrive on different listeners", () => {
    const config = gen({ urlRules: buildUrlRules("GET https://a.com/x\nGET http://b.com/y") });
    expect(config.includes("acl s0_host")).toBe(true);
    expect(config.includes("acl p0_host")).toBe(true);
  });

  it("refuses everything for a scheme with no rules", () => {
    const config = gen({ httpsRules: ["a.com:443"] });
    // The plaintext listener has no rules, so it denies outright.
    expect(config.includes("# No rules for this scheme, so nothing is permitted.")).toBe(true);
  });

  it("writes nothing below that deny, which carries no condition and so is final", () => {
    // HAProxy skips every http-request rule after an unconditional deny and
    // warns that they are NOOP. The resolver block is what would follow here.
    const plain = frontendSegment(gen({ ...FULL, httpRules: [] }), "http_in");
    expect(plain.includes("# No rules for this scheme, so nothing is permitted.")).toBe(true);
    expect(plain.includes("do-resolve")).toBe(false);
    expect(plain.includes("acl dst_internal")).toBe(false);
  });

  it("references named acls bare, since braces are for anonymous expressions", () => {
    const config = gen({ httpsRules: ["a.com:443"] });
    expect(config.includes("-m bool } { s0_host }")).toBe(false);
    expect(config.includes("bool(true) if !{ var(txn.allowed) -m bool } s0_host")).toBe(true);
    // The verdict variable has no acl of its own, so it is the anonymous case.
    expect(config.includes("http-request deny unless { var(txn.allowed) -m bool }")).toBe(true);
  });

  it("decides with one line per rule, which no rule count can outgrow", () => {
    const rules = Array.from({ length: 40 }, (_, i) => `GET https://h${i}.example.com/pkg/**`);
    const config = gen({ urlRules: buildUrlRules(rules.join("\n")) });
    expect(config.includes("-m bool } s39_host")).toBe(true);
    expect(longestLineWords(config) <= MAX_LINE_WORDS).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Passed through without inspection
// ---------------------------------------------------------------------------
describe("passthrough", () => {
  const config = gen(FULL);

  it("routes ip rules by address and port, before anything is decrypted", () => {
    expect(config.includes("acl ip0_dst dst 10.0.0.5")).toBe(true);
    expect(config.includes("acl ip0_port dst_port 5432")).toBe(true);
  });

  it("reduces the SNI to a safe charset before logging it", () => {
    // ACL matching still runs on the untouched req.ssl_sni; only the copy
    // that reaches the passthrough log line is sanitized.
    expect(config.includes("set-var(txn.sni) req.ssl_sni,regsub([^A-Za-z0-9._-],_,g)")).toBe(true);
  });

  it("routes tls rules by SNI, and by the port the rule names", () => {
    expect(config.includes("acl tls0_sni req.ssl_sni -m reg -i ^db\\\\.example\\\\.com$")).toBe(
      true,
    );
    // The port used to be dropped, so db.example.com:443 was permitted too.
    expect(config.includes("acl tls0_port dst_port 443")).toBe(true);
    expect(
      config.includes("tcp-request content set-var(txn.pass) int(1) if tls0_sni tls0_port"),
    ).toBe(true);
  });

  it("matches a ~regex tls rule's host and port as one expression against the SNI stringified", () => {
    const result = generateHaproxyConfig({ tlsRules: ["~^.*\\.example\\.com:(5432|5433)$"] });
    expect(result.config.includes("set-var-fmt(txn.sni_port) %[req.ssl_sni]:%[dst_port]")).toBe(
      true,
    );
    expect(
      result.config.includes(
        "acl tls0_sni var(txn.sni_port) -m reg -i ^.*\\\\.example\\\\.com:(5432|5433)$",
      ),
    ).toBe(true);
    // The pattern's own port coverage replaces dst_port entirely.
    expect(result.config.includes("tls0_port")).toBe(false);
  });

  it("also scopes the early do-resolve trigger by port, not just the backend selection", () => {
    // Regression: this used to set txn.tlsrule from the SNI ACL alone, so an
    // SNI matching db.example.com on a *different* port than the rule names
    // still triggered do-resolve/set-dst here -- overwriting the connection's
    // destination before the inspected path ever saw it -- even though
    // txn.pass (gated on sni+port together) correctly never fired for it.
    expect(config.includes("set-var(txn.tlsrule) int(1) if tls0_sni tls0_port")).toBe(true);
  });

  it("runs every content rule before the accept that ends their evaluation", () => {
    // `tcp-request content accept` stops the rest of the content rules, so a
    // set-var or do-resolve placed after it never runs at all -- silently, and
    // with the passthrough still working, just to the client's own address.
    const resolve = config.indexOf("tcp-request content do-resolve");
    const accept = config.indexOf("tcp-request content accept");
    expect(resolve !== -1 && resolve < accept).toBe(true);
  });

  it("connects a passthrough where it resolved the SNI, not where the client aimed", () => {
    // Not decrypting is no reason to let the client pick the destination: a
    // ClientHello carrying an allowed name could otherwise be sent anywhere,
    // turning any TLS rule into a raw tunnel to an address of its choosing.
    expect(
      config.includes(
        "tcp-request content do-resolve(txn.dst,buildcage,ipv4) req.ssl_sni,lower if { var(txn.tlsrule) -m found }",
      ),
    ).toBe(true);
    expect(config.includes("tcp-request content set-dst var(txn.dst)")).toBe(true);
    // Falling through would connect to the address the client chose.
    expect(
      config.includes(
        "tcp-request content reject if { var(txn.tlsrule) -m found } !{ var(txn.dst) -m found }",
      ),
    ).toBe(true);
  });

  it("sends both to a tcp backend that never terminates", () => {
    expect(
      config.includes("tcp-request content set-var(txn.pass) int(1) if ip0_dst ip0_port"),
    ).toBe(true);
    expect(config.includes("tcp-request content set-var(txn.pass) int(1) if tls0_sni")).toBe(true);
    expect(config.includes("use_backend passthrough if { var(txn.pass) -m found }")).toBe(true);
    expect(config.includes("backend passthrough\n    mode tcp")).toBe(true);
  });

  it("selects that backend below the accept, where the file reads as it runs", () => {
    // Backend selection happens after every content rule whatever the written
    // order, so a use_backend above the accept is only misleading -- and
    // HAProxy warns about it.
    const detect = frontendSegment(config, "detect");
    const accept = detect.indexOf("tcp-request content accept");
    const select = detect.indexOf("use_backend passthrough");
    expect(accept !== -1 && accept < select).toBe(true);
  });

  it("omits the port acl when the rule names every port", () => {
    expect(gen({ ipRules: ["10.0.0.5:*"] }).includes("ip0_port")).toBe(false);
  });

  it("flags a passthrough one line per rule, which no rule count can outgrow", () => {
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

  it("refuses an address pattern rather than approximating a range", () => {
    const result = generateHaproxyConfig({ ipRules: ["10.0.0.*:5432"] });
    expect(result.warnings.length).toBe(1);
    expect(result.config.includes("ip0_dst")).toBe(false);
  });

  it("matches a ~regex ip rule's address and port as one expression against the destination stringified", () => {
    const result = generateHaproxyConfig({
      ipRules: ["~^192\\.168\\.1\\.\\d+:(8080|8081)$"],
    });
    expect(result.warnings.length).toBe(0);
    expect(result.config.includes("set-var-fmt(txn.dst_str) %[dst]:%[dst_port]")).toBe(true);
    expect(
      result.config.includes(
        "acl ip0_dst var(txn.dst_str) -m reg ^192\\\\.168\\\\.1\\\\.\\\\d+:(8080|8081)$",
      ),
    ).toBe(true);
    // The pattern's own port coverage replaces dst_port entirely.
    expect(result.config.includes("ip0_port")).toBe(false);
    // A literal rule still matches dst directly -- no need to stringify it.
    expect(
      generateHaproxyConfig({ ipRules: ["10.0.0.5:5432"] }).config.includes(
        "set-var-fmt(txn.dst_str)",
      ),
    ).toBe(false);
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

// ---------------------------------------------------------------------------
// ~regex url rules: host half matched bare/full, path stays a separate ACL
// ---------------------------------------------------------------------------
describe("regex url rules", () => {
  it("builds the shared bare/full host variables and the default-port gate", () => {
    const result = generateHaproxyConfig({ urlRules: buildUrlRules("GET ~^https://a\\.com/x$") });
    expect(result.warnings.length).toBe(0);
    const segment = frontendSegment(result.config, "https_in");
    expect(segment.includes("acl is_default_port dst_port 443")).toBe(true);
    expect(segment.includes("set-var(txn.host_bare) hdr(host),host_only,regsub(\\.$,)")).toBe(true);
    expect(
      segment.includes(
        "set-var-fmt(txn.host_full) %[hdr(host),host_only,regsub(\\.$,)]:%[dst_port]",
      ),
    ).toBe(true);
  });

  it("ORs a bare (default-port-only) match with a full (real-port) match per rule", () => {
    const result = generateHaproxyConfig({ urlRules: buildUrlRules("GET ~^https://a\\.com/x$") });
    const segment = frontendSegment(result.config, "https_in");
    expect(segment.includes("set-var(txn.s0_ok) bool(false)")).toBe(true);
    expect(
      segment.includes(
        "set-var(txn.s0_ok) bool(true) if is_default_port { var(txn.host_bare) -m reg -i ^a\\\\.com$ }",
      ),
    ).toBe(true);
    expect(
      segment.includes(
        "set-var(txn.s0_ok) bool(true) if { var(txn.host_full) -m reg -i ^a\\\\.com$ }",
      ),
    ).toBe(true);
    expect(segment.includes("acl s0_host var(txn.s0_ok) -m bool")).toBe(true);
    expect(segment.includes("path -m str /x")).toBe(true);
    expect(
      segment.includes("bool(true) if !{ var(txn.allowed) -m bool } s0_host s0_path s0_method"),
    ).toBe(true);
    // No dst_port ACL at all: the bare/full duality covers the port.
    expect(segment.includes("s0_port")).toBe(false);
  });

  it("allows a non-literal port in the host half, matched as written", () => {
    const result = generateHaproxyConfig({
      urlRules: buildUrlRules("GET ~^https://a\\.com:(443|8443)/x$"),
    });
    expect(result.warnings.length).toBe(0);
    const segment = frontendSegment(result.config, "https_in");
    expect(segment.includes("-m reg -i ^a\\\\.com:(443|8443)$")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Escaping for HAProxy's own config parser
// ---------------------------------------------------------------------------
describe("escaping rule text for the config parser", () => {
  it("escapes a '#' in a path, which would otherwise comment the ACL short", () => {
    // Verified against haproxy 3.2 by generating this config with the escape
    // removed: it reports `regex '^/pkg(x' is invalid` for `^/pkg(x#y)$`, so
    // everything from the `#` really is dropped. With a pattern that stays
    // valid when cut short, nothing would report anything and the rule would
    // quietly allow every path merely starting with `/pkg`.
    const result = generateHaproxyConfig({
      urlRules: buildUrlRules("GET ~^https://a\\.com/pkg#frag$"),
    });
    const segment = frontendSegment(result.config, "https_in");
    expect(segment.includes("path -m reg ^/pkg\\#frag$")).toBe(true);
    expect(segment.includes("path -m reg ^/pkg#frag$")).toBe(false);
  });

  it("escapes quotes, which the parser would otherwise read as opening a string", () => {
    const result = generateHaproxyConfig({
      urlRules: buildUrlRules(`GET ~^https://a\\.com/['"]$`),
    });
    const segment = frontendSegment(result.config, "https_in");
    expect(segment.includes(`path -m reg ^/[\\'\\"]$`)).toBe(true);
  });

  it("doubles a backslash, since that is the one escape the parser folds", () => {
    // `\.` reaches the regex engine as written, but `\\` collapses to `\`, so
    // every backslash has to be doubled for the pair to survive together.
    const result = generateHaproxyConfig({ httpsRules: ["*.a.com:443"] });
    expect(result.config.includes("-m reg -i ^[^.]+\\\\.a\\\\.com$")).toBe(true);
  });

  it("escapes a '#' in an SNI rule and in a regex ip rule too", () => {
    const result = generateHaproxyConfig({
      tlsRules: ["~^a#b\\.com:443$"],
      ipRules: ["~^10\\.0\\.0\\.1#x:443$"],
    });
    expect(result.config.includes("acl tls0_sni var(txn.sni_port) -m reg -i ^a\\#b")).toBe(true);
    expect(
      result.config.includes("acl ip0_dst var(txn.dst_str) -m reg ^10\\\\.0\\\\.0\\\\.1\\#x"),
    ).toBe(true);
  });
});

reportResults();

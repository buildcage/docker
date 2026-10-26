import { PROXY_SUBNET } from "../log/proxy-address.ts";
import { expectInOrder, FULL_RULES, plainStage, tlsStage } from "../test/config-text.ts";
import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import type { InspectLogFields, InspectStageExtension } from "./haproxy-inspect-stage.ts";
import { buildUrlRules } from "./url-rules.ts";

/** An extension whose rules say only where they landed. */
const EXTENSION: InspectStageExtension = {
  requestRules: (mode) => [`    # extension request rules (${mode})`],
  responseRules: () => ["    # extension response rules"],
};

describe("inspect stage", () => {
  it("blocks a request with no Host before it judges the path", () => {
    // Both are blocks, so only the reason turns on the order, and one of the
    // two names a host the report can act on where the other leaves the `-`
    // the log prints for a Host that never came. No rule is needed to see it:
    // both checks sit above the rule block whatever is written there.
    const plain = plainStage({});
    expectInOrder(plain, ["missing-host-header", "path -m sub"]);
  });

  it("sets the Host every step reads ahead of the rules, in audit too", () => {
    // Lowercased, as do-resolve looks a name up, and stripped of its port and
    // a trailing dot: "a.com." is the same DNS name as "a.com" (RFC 1035),
    // and some tools write it that way to skip resolv.conf's search list.
    const set = "http-request set-var(txn.host) req.hdr(host),lower,host_only,regsub(\\.$,)";
    const plain = plainStage({ httpRules: ["a.com:80"] });
    expect(plain).toContain(set);
    expectInOrder(plain, [set, "set-var(txn.allowed)"]);
    // audit has no rule block, but still resolves from it.
    expect(plainStage({}, "audit")).toContain(set);
  });

  it("blocks a Host that is not a hostname before any rule or resolution, in audit too", () => {
    // `Host: a.com:x.evil.com:80` keeps `a.com:x.evil.com` after host_only,
    // which `~^https?://a\.com:.*/.*$` would match and do-resolve look up.
    for (const mode of ["restrict", "audit"] as const) {
      const plain = plainStage({ httpRules: ["~^a\\.com:.*$"] }, mode);
      const deny = "http-request deny deny_status 400 if !host_is_name";
      expect(plain).toContain("acl host_is_name var(txn.host) -m reg ^[A-Za-z0-9._-]+$");
      expect(plain).toContain("set-var(txn.reason) str(invalid-host) if !host_is_name");
      expectInOrder(plain, ["set-var(txn.host)", deny, "do-resolve"]);
      if (mode === "restrict") expectInOrder(plain, [deny, "set-var(txn.allowed)"]);
    }
  });

  it("writes nothing below a deny that carries no condition and so is final", () => {
    // HAProxy skips every http-request rule after an unconditional deny and
    // warns that they are NOOP. The resolver block is what would follow here.
    const plain = plainStage({ httpsRules: ["a.example.com:443"] });
    expect(plain).toContain("# No rules for this scheme, so nothing is permitted.");
    expect(plain).not.toContain("do-resolve");
    expect(plain).not.toContain("acl dst_internal");
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
    expect(plain).toContain(`acl dst_proxy_self var(txn.dst) -m ip ${PROXY_SUBNET}`);
    expect(plain).toContain("acl dst_proxy_self dst_port 10024");
    expect(plain).toContain(
      "deny deny_status 403 if dst_internal !named_address or dst_internal dst_proxy_self\n",
    );
  });

  it("keeps the exemption in audit, where no rule is enforced", () => {
    // audit emits no rule block, so the exemption cannot lean on it.
    const plain = plainStage({ httpRules: ["169.254.169.254:80"] }, "audit");
    expect(plain).not.toContain("txn.allowed");
    expect(plain).toContain("-m str 169.254.169.254 } { dst_port 80 }");
    expect(plain).toContain("deny deny_status 403 if dst_internal !named_address");
  });
});

const STAGES = [tlsStage(FULL_RULES), plainStage(FULL_RULES)];

describe("where a request is sent", () => {
  it("connects where it resolved the name, not where the client aimed", () => {
    // Removes the forged-Host class of attack rather than detecting it.
    for (const stage of STAGES) {
      expect(stage).toContain("http-request do-resolve(txn.dst,buildcage,ipv4) var(txn.host)");
      expect(stage).toContain("http-request set-dst var(txn.dst)");
    }
  });

  it("takes an address in the Host header as it stands, asking no resolver", () => {
    // No resolver can answer an address, so asking would fail and block the
    // request, leaving a rule that names an address impossible to satisfy.
    const plain = plainStage(FULL_RULES);
    expect(plain).toContain("acl host_is_address var(txn.host) -m reg ^(25[0-5]");
    expect(plain).toContain("http-request set-var(txn.dst) var(txn.host) if host_is_address");
    expect(plain).toContain("var(txn.host) unless host_is_address");
  });

  it("takes only a whole decimal address as one, since what matches is never checked again", () => {
    // Whatever the pattern admits goes to set-dst unresolved, so a name that
    // merely starts with an address must fall through to the resolver.
    const acl = plainStage(FULL_RULES)
      .split("\n")
      .find((l) => l.includes("acl host_is_address"))!;
    const regex = new RegExp(acl.slice(acl.indexOf("-m reg ") + 7));
    expect(regex.test("10.0.0.5")).toBe(true);
    expect(regex.test("255.255.255.255")).toBe(true);
    expect(regex.test("999.1.2.3")).toBe(false);
    expect(regex.test("010.0.0.1")).toBe(false);
    expect(regex.test("1.2.3.4.evil.example")).toBe(false);
    expect(regex.test("1.2.3")).toBe(false);
  });

  it("reads the Host header once, so every step sees the same value", () => {
    // An acl on req.hdr(host) scans every value a header carries while a fetch
    // takes the last, so an acl reading the header could pass a value other
    // than the one resolved and connected to. Besides txn.host, only the
    // logged copy reads a value, and has_host only asks whether one exists.
    for (const stage of STAGES) {
      const reads = stage
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("#") && /\bhdr\(host\)/.test(l));
      expect(reads.map((l) => l.trim().split(" ")[1])).toStrictEqual([
        "set-var(txn.host_log)",
        "has_host",
        "set-var(txn.host)",
      ]);
    }
  });

  it("blocks a request whose name it could not resolve", () => {
    for (const stage of STAGES) {
      expect(stage).toContain("http-request deny deny_status 502 unless { var(txn.dst) -m found }");
    }
  });
});

describe("resolving, which only a request the rules already admitted reaches", () => {
  it("denies on host, path and method before resolving", () => {
    for (const stage of STAGES) {
      expectInOrder(stage, [
        "set-var(txn.allowed) bool(true)",
        "http-request deny unless",
        "do-resolve(txn.dst,buildcage,ipv4) var(txn.host)",
      ]);
    }
  });

  it("sets the resolved destination before the internal-address check, not after", () => {
    // %[dst] in the log-format reads whatever set-dst last wrote. CoreDNS
    // never hands the build a real address (see coredns-config.ts), so a
    // block logged before set-dst ran would show the build's own fake
    // destination instead of the real one that tripped the guard.
    for (const stage of STAGES) {
      expectInOrder(stage, [
        "http-request set-dst var(txn.dst)",
        "deny deny_status 403 if dst_internal",
      ]);
    }
  });

  it("retries a resolution once, still exempting an address and a hit", () => {
    // A failed resolution is not cached, so the second call is a fresh attempt.
    // Dropping either guard would resolve a literal address or overwrite a
    // destination the first call already found.
    for (const stage of STAGES) {
      const resolves = stage
        .split("\n")
        .filter((l) => l.includes("do-resolve(txn.dst,buildcage,ipv4) var(txn.host)"));
      expect(resolves.length).toBe(2);
      expect(resolves[1].endsWith("unless host_is_address or { var(txn.dst) -m found }")).toBe(
        true,
      );
    }
  });

  it("still resolves in audit for a scheme with no rules, having denied nothing above", () => {
    // Only restrict's unconditional deny makes the rest of a stage dead.
    expect(plainStage({}, "audit")).toContain("do-resolve(txn.dst,buildcage,ipv4) var(txn.host)");
  });

  it("guards with no exemption when a wildcard merely admits an address", () => {
    const plain = plainStage({ httpRules: ["**:80", "*.*.*.*:80"] });
    expect(plain).not.toContain("named_address");
    expect(plain).toContain("deny deny_status 403 if dst_internal\n");
  });
});

describe("what a log line records", () => {
  it("records the path in a form that does not depend on the HTTP version", () => {
    // %HU is the request target as sent: a path over HTTP/1.1, an absolute URI
    // over HTTP/2.
    const plain = plainStage(FULL_RULES);
    expect(plain).not.toContain("host=%[var(txn.host_log)] %HU");
    expect(plain).toContain("host=%[var(txn.host_log)] %[var(txn.pathq)]");
    expect(plain).toContain("http-request set-var(txn.pathq) 'pathq,regsub(");
  });

  it("strips whitespace, quotes and control chars from the Host header and the path before logging them", () => {
    // Both are attacker-controlled; the rules still match on the untouched
    // fetches. The Host header legitimately carries its own ":port", so unlike
    // the SNI it can't be reduced to a hostname charset.
    const plain = plainStage(FULL_RULES);
    expect(plain).toContain(
      `http-request set-var(txn.host_log) 'req.hdr(host),regsub("[\\s\\"[:cntrl:]]",_,g)'`,
    );
    expect(plain).toContain(`http-request set-var(txn.pathq) 'pathq,regsub("[\\"[:cntrl:]]",_,g)'`);
    // The same class in JavaScript: a non-default port's ':' survives.
    expect("allowed.example.com:9443".replace(/[\s"\p{Cc}]/gu, "_")).toBe(
      "allowed.example.com:9443",
    );
  });

  it("logs the SNI on the stage that terminates TLS, reduced to a hostname charset", () => {
    // The only name a connection that sent no request ever gave. The plain
    // stage terminates no TLS, so it has none to log.
    const logFormat = (stage: string) =>
      stage.split("\n").find((line) => line.trim().startsWith("log-format "))!;
    expect(logFormat(tlsStage(FULL_RULES))).toContain(
      "sni=%[ssl_fc_sni,regsub([^A-Za-z0-9._-],_,g)]",
    );
    expect(logFormat(plainStage(FULL_RULES))).not.toContain("sni=");
  });

  it("puts the SNI and the host ahead of the target, not after it", () => {
    // The target is the field the build sizes, so a cut line costs the target
    // and both names that say which host it was survive.
    const https = tlsStage(FULL_RULES)
      .split("\n")
      .find((line) => line.trim().startsWith("log-format "))!;
    expectInOrder(https, ["sni=", "host=%[var(txn.host_log)", "%[var(txn.pathq)]"]);
  });

  it("logs the Host in full rather than through a fixed-length capture", () => {
    // A capture cuts at its length, so a name padded past it would reach the
    // report without the domain that registered it.
    for (const stage of STAGES) expect(stage).not.toContain("http-request capture");
  });

  it("records the path after normalizing it and before blocking a traversal", () => {
    // Denying first leaves txn.pathq unset, which the log prints as `-`, so
    // exactly the requests worth seeing would lose their URL.
    for (const stage of STAGES) {
      expectInOrder(stage, [
        "normalize-uri path-strip-dotdot",
        "set-var(txn.pathq)",
        "deny deny_status 403 if { path -m reg",
      ]);
    }
  });
});

describe("the path the rules see", () => {
  it("decodes, then strips dot-dots, then lets the rules look at the path", () => {
    // `.` is unreserved, so `%2e%2e` is not a dot-dot segment until it has been
    // decoded. Stripping first leaves it intact: the rules see a path that
    // never leaves /public/, and the origin resolves it somewhere else.
    for (const stage of STAGES) {
      expectInOrder(stage, [
        "normalize-uri percent-decode-unreserved",
        "normalize-uri path-strip-dotdot",
        "set-var(txn.allowed) bool(true)",
      ]);
    }
  });

  it("blocks a dot-dot beside an encoded slash or backslash", () => {
    // `/` and `\\` are both separators an origin may honour: `%2f` is reserved
    // so it survives decoding, and the URL standard treats `\\` as `/` for
    // http(s). An encoded separator on its own stays legitimate.
    for (const stage of STAGES) {
      expect(stage).toContain(
        "http-request deny deny_status 403 if { path -m reg -i (^|/|%2f|%5c)\\.\\.($|/|;|%2f|%5c|%3b) }",
      );
    }
  });

  it("blocks a dot-dot ended by a path parameter", () => {
    // Tomcat and Jetty drop `;...` from a segment, so `/public/..;/secret` is
    // `/secret` to them. HAProxy strips only a bare `..`, and the rules would
    // match `/public/`.
    const re = /(^|\/|%2f|%5c)\.\.($|\/|;|%2f|%5c|%3b)/i;
    for (const p of [
      "/public/..;/secret",
      "/public/..%3B/secret",
      "/public/..;jsessionid=x/secret",
    ])
      expect(re.test(p)).toBe(true);
    for (const p of ["/public/pkg;v=1", "/public/my..;x", "/public/@scope%2fpkg"])
      expect(re.test(p)).toBe(false);
  });

  it("blocks a raw backslash outright, it being no valid path character", () => {
    // `\\\\` in the source is `\\` in the generated config, which HAProxy's
    // parser reads as one literal backslash.
    for (const stage of STAGES) {
      expect(stage).toContain("http-request deny deny_status 403 if { path -m sub \\\\ }");
    }
  });
});

describe("request timeouts", () => {
  it("leaves the TLS stage on the client timeout", () => {
    expect(tlsStage(FULL_RULES)).not.toContain("timeout http-request");
  });
});

describe("extension", () => {
  const rules = { httpRules: ["~^b\\.example\\.com:80$"] };

  it("is left out, log field and all, when there is none", () => {
    const plain = plainStage(rules);
    expect(plain).not.toContain("extension");
    expect(plain).not.toContain("wb=");
  });

  it("logs each field it names after what restrict would block", () => {
    const plain = plainStage(rules, "restrict", {
      ...EXTENSION,
      logFields: { name: "example", fields: { kind: "txn.example_kind" } },
    });
    expect(plain).toContain(
      "wb=%[var(txn.would_block),regsub([^A-Za-z0-9._-],_,g)] example.kind=%[var(txn.example_kind),regsub([^A-Za-z0-9._-],_,g)] host=",
    );
  });

  it("refuses a field name the log parser could not read back, or a variable it would have to quote", () => {
    const invalid: InspectLogFields[] = [
      { name: "Example", fields: { kind: "txn.example_kind" } },
      { name: "example", fields: { "kind=x": "txn.example_kind" } },
      { name: "example", fields: { kind: "txn.example kind" } },
      { name: "example", fields: { kind: "req.hdr(host)" } },
    ];
    for (const logFields of invalid) {
      expect(() => plainStage(rules, "restrict", { ...EXTENSION, logFields })).toThrow(
        /invalid log field/,
      );
    }
  });

  it("refuses an object name the log parser could not read back, even with no field", () => {
    expect(() =>
      plainStage(rules, "restrict", { ...EXTENSION, logFields: { name: "Example", fields: {} } }),
    ).toThrow(/invalid log field object/);
  });

  it("logs what restrict would block ahead of the host", () => {
    const plain = plainStage(rules, "restrict", EXTENSION);
    expect(plain).toContain(
      "dst=%[dst]:%[dst_port] wb=%[var(txn.would_block),regsub([^A-Za-z0-9._-],_,g)] host=",
    );
  });

  it("runs after the rules and before the name is resolved, told the mode", () => {
    expectInOrder(plainStage(rules, "audit", EXTENSION), [
      "    # extension request rules (audit)",
      "do-resolve",
    ]);
    expectInOrder(plainStage(rules, "restrict", EXTENSION), [
      "http-request deny unless { var(txn.allowed) -m bool }",
      "    # extension request rules (restrict)",
    ]);
  });

  it("adds response rules to the TLS stage alone", () => {
    expect(tlsStage({ httpsRules: ["~^b\\.example\\.com:443$"] }, "audit", EXTENSION)).toContain(
      "extension response rules",
    );
    expect(plainStage(rules, "audit", EXTENSION)).not.toContain("extension response rules");
  });

  // Nothing may follow a deny that always fires; see deniesEverything.
  it("is left out where the rules block everything", () => {
    const plain = plainStage({}, "restrict", EXTENSION);
    expect(plain).not.toContain("extension request rules");
  });
});

reportResults();

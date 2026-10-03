import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import { detectFrontend, type DetectFrontendSpec } from "./haproxy-detect-frontend.ts";
import { compileRuleSet, INTERNAL_RANGES, type RuleInputs } from "./haproxy-rules.ts";

const FULL: RuleInputs = {
  ipRules: ["10.0.0.5:5432"],
  tlsRules: ["db.example.com:443"],
};

/** The detect frontend for these rules, as the generated config carries it. */
function detect(inputs: RuleInputs = {}, options: Partial<DetectFrontendSpec> = {}): string {
  const { ip, tls } = compileRuleSet(inputs);
  return detectFrontend({
    listenPort: 10024,
    tlsStagePort: 10025,
    plainStagePort: 10026,
    ipRules: ip,
    tlsHosts: tls,
    internalAddrs: INTERNAL_RANGES,
    proxyAddress: "198.19.255.1",
    ...options,
  }).join("\n");
}

describe("passthrough", () => {
  const config = detect(FULL);
  it("routes ip rules by address and port, before anything is decrypted", () => {
    expect(config.includes("acl ip0_dst dst 10.0.0.5")).toBe(true);
    expect(config.includes("acl ip0_port dst_port 5432")).toBe(true);
  });

  it("reduces the SNI to a safe charset before logging it", () => {
    // ACL matching still runs on the untouched req.ssl_sni; only the copy
    // that reaches the passthrough log line is sanitized.
    expect(config.includes("set-var(txn.sni) req.ssl_sni,regsub([^A-Za-z0-9._-],_,g)")).toBe(true);
  });

  it("logs the SNI only for a connection a tls rule passed", () => {
    const capture = "set-var(txn.sni) req.ssl_sni,regsub([^A-Za-z0-9._-],_,g)";
    // An ip rule's connection is accepted before it, so txn.pass means a tls rule.
    expect(config.split(capture).length).toBe(2);
    expect(config.includes(`${capture} if { var(txn.pass) -m found }`)).toBe(true);
    expect(config.indexOf(capture) > config.indexOf("accept if { var(txn.pass) -m found }")).toBe(
      true,
    );
    expect(detect({ ipRules: ["10.0.0.5:5432"] }).includes("set-var(txn.sni)")).toBe(false);
  });

  it("routes tls rules by SNI, and by the port the rule names", () => {
    expect(config.includes("acl tls0_sni req.ssl_sni -m reg -i ^db\\\\.example\\\\.com$")).toBe(
      true,
    );
    // Without the port ACL, db.example.com would be permitted on any port.
    expect(config.includes("acl tls0_port dst_port 443")).toBe(true);
    expect(
      config.includes("tcp-request content set-var(txn.pass) int(1) if tls0_sni tls0_port"),
    ).toBe(true);
  });

  it("matches a ~regex tls rule's host and port as one expression against the SNI stringified", () => {
    const result = detect({ tlsRules: ["~^.*\\.example\\.com:(5432|5433)$"] });
    expect(result.includes("set-var-fmt(txn.sni_port) %[req.ssl_sni]:%[dst_port]")).toBe(true);
    expect(
      result.includes(
        "acl tls0_sni var(txn.sni_port) -m reg -i ^.*\\\\.example\\\\.com:(5432|5433)$",
      ),
    ).toBe(true);
    // The pattern's own port coverage replaces dst_port entirely.
    expect(result.includes("tls0_port")).toBe(false);
  });

  it("also scopes the early do-resolve trigger by port, not just the backend selection", () => {
    // An SNI allowed on another port must not have its destination replaced
    // before the inspected path sees it.
    expect(config.includes("set-var(txn.pass) int(1) if tls0_sni tls0_port sni_is_name")).toBe(
      true,
    );
    expect(
      config.includes(
        "do-resolve(txn.dst,buildcage,ipv4) req.ssl_sni,lower if { var(txn.pass) -m found }",
      ),
    ).toBe(true);
  });

  it("runs every content rule before the accept that ends the content rules' evaluation", () => {
    // `tcp-request content accept` stops the rest of the content rules, so a
    // set-var or do-resolve placed after it never runs, silently, with the
    // passthrough still working but going to the client's own address.
    const resolve = config.indexOf("tcp-request content do-resolve");
    const accept = config.indexOf("tcp-request content accept if { req.ssl_hello_type 1 }");
    expect(resolve !== -1 && resolve < accept).toBe(true);
  });

  it("waits for a ClientHello split across segments before accepting plaintext", () => {
    // In one rule, `{ req.len gt 0 }` matches the first segment of a
    // ClientHello and sends TLS down the plaintext path.
    const tls = config.indexOf("tcp-request content accept if { req.ssl_hello_type 1 }\n");
    const plain = config.indexOf("tcp-request content accept if { req.len gt 0 }\n");
    expect(tls !== -1 && tls < plain).toBe(true);
  });

  it("passes an ip rule's connection through without waiting for the client to speak", () => {
    // HAProxy holds a rule that reads the request buffer until bytes arrive or
    // inspect-delay runs out, and a server-first client sends none. So only
    // what an ip rule needs may run before this accept.
    const rules = detect({
      ...FULL,
      ipRules: ["10.0.0.5:5432", "~^10\\.1\\.0\\.\\d+:6379$"],
    })
      .split("\n")
      .filter((l) => l.includes("tcp-request content"))
      .map((l) => l.trim());
    const accept = rules.indexOf("tcp-request content accept if { var(txn.pass) -m found }");
    const self = "{ var(txn.pass) -m found } ip_dst_internal { dst_port 10024 }";
    expect(rules.slice(0, accept)).toStrictEqual([
      "tcp-request content set-var-fmt(txn.dst_str) %[dst]:%[dst_port]",
      "tcp-request content set-var(txn.pass) int(1) if ip0_dst ip0_port !dns_routed",
      "tcp-request content set-var(txn.pass) int(1) if ip1_dst !dns_routed",
      "tcp-request content set-var(txn.proto) str(tcp) if { var(txn.pass) -m found }",
      `tcp-request content set-var(txn.reason) str(internal-address) if ${self}`,
      `tcp-request content reject if ${self}`,
    ]);
  });

  it("leaves a connection an ip rule also covers to that rule, whatever SNI it carries", () => {
    // The ip rule names the address itself, so the SNI neither redirects nor
    // refuses it; the tls rule's resolution never runs for it.
    const overlap = detect({ ...FULL, ipRules: ["10.0.0.0/8:443"] });
    const accept = overlap.indexOf("tcp-request content accept if { var(txn.pass) -m found }");
    expect(accept).not.toBe(-1);
    expect(overlap.indexOf("set-var(txn.pass) int(1) if tls0_sni") > accept).toBe(true);
    expect(overlap.indexOf("tcp-request content do-resolve") > accept).toBe(true);
  });

  it("connects a passthrough where it resolved the SNI, not where the client aimed", () => {
    // Not decrypting is no reason to let the client pick the destination: a
    // ClientHello carrying an allowed name could otherwise be sent anywhere,
    // turning any TLS rule into a raw tunnel to an address of the build's
    // choosing.
    expect(
      config.includes(
        "tcp-request content do-resolve(txn.dst,buildcage,ipv4) req.ssl_sni,lower if { var(txn.pass) -m found }",
      ),
    ).toBe(true);
    expect(config.includes("tcp-request content set-dst var(txn.dst)")).toBe(true);
    expect(
      config.includes(
        "tcp-request content reject if { var(txn.pass) -m found } !{ var(txn.dst) -m found }",
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
    const accept = config.indexOf("tcp-request content accept");
    const select = config.indexOf("use_backend passthrough");
    expect(accept !== -1 && accept < select).toBe(true);
  });

  it("omits the port acl when the rule names every port", () => {
    expect(detect({ ipRules: ["10.0.0.5:*"] }).includes("ip0_port")).toBe(false);
  });

  it("matches a ~regex ip rule's address and port as one expression against the destination stringified", () => {
    const result = detect({
      ipRules: ["~^192\\.168\\.1\\.\\d+:(8080|8081)$"],
    });
    expect(result.includes("set-var-fmt(txn.dst_str) %[dst]:%[dst_port]")).toBe(true);
    expect(
      result.includes(
        "acl ip0_dst var(txn.dst_str) -m reg ^192\\\\.168\\\\.1\\\\.\\\\d+:(8080|8081)$",
      ),
    ).toBe(true);
    // The pattern's own port coverage replaces dst_port entirely.
    expect(result.includes("ip0_port")).toBe(false);
    // A literal rule still matches dst directly, with no need to stringify it.
    expect(detect({ ipRules: ["10.0.0.5:5432"] }).includes("set-var-fmt(txn.dst_str)")).toBe(false);
  });

  it("escapes a '#' in an SNI rule and in a regex ip rule too", () => {
    const result = detect({
      tlsRules: ["~^a#b\\.com:443$"],
      ipRules: ["~^10\\.0\\.0\\.1#x:443$"],
    });
    expect(result.includes("acl tls0_sni var(txn.sni_port) -m reg -i ^a\\#b")).toBe(true);
    expect(result.includes("acl ip0_dst var(txn.dst_str) -m reg ^10\\\\.0\\\\.0\\\\.1\\#x")).toBe(
      true,
    );
  });

  // The port ACL is what keeps an allowed SNI on a different port from setting
  // the flag; a rule covering every port has none to gate on.
  it("gates the pass flag on the SNI alone for a rule covering every port", () => {
    const anyPort = detect({ tlsRules: ["db.example.com:*"] });
    expect(anyPort).toMatch(/set-var\(txn\.pass\) int\(1\) if tls0_sni sni_is_name\n/);
  });
});

describe("an SNI that is not a hostname", () => {
  // `db.example.com:x.evil.com` would match `~^db\.example\.com:.*$` and
  // resolve under evil.com.
  const result = detect({ tlsRules: ["~^db\\.example\\.com:.*$", "db.example.com:443"] });

  it("is checked against the hostname charset", () => {
    expect(result.includes("acl sni_is_name req.ssl_sni -m reg ^[A-Za-z0-9._-]+$")).toBe(true);
  });

  it("neither passes through nor resolves, whichever form the rule takes", () => {
    for (const cond of ["tls0_sni sni_is_name", "tls1_sni tls1_port sni_is_name"]) {
      expect(result.includes(`set-var(txn.pass) int(1) if ${cond}\n`)).toBe(true);
    }
  });

  it("is not checked without a tls rule", () => {
    expect(detect({ ipRules: ["10.0.0.5:5432"] }).includes("sni_is_name")).toBe(false);
  });
});

describe("ip rules and the proxy's own address", () => {
  it("never passes through a connection that reached the proxy through a name", () => {
    // 198.18.0.0/15 covers the proxy, which every name resolves to.
    const result = detect({ ipRules: ["198.18.0.0/15:443", "~^198\\.19\\.255\\.1:443$"] });
    expect(result.includes("acl dns_routed dst 198.19.255.1")).toBe(true);
    expect(result.includes("set-var(txn.pass) int(1) if ip0_dst ip0_port !dns_routed\n")).toBe(
      true,
    );
    expect(result.includes("set-var(txn.pass) int(1) if ip1_dst !dns_routed\n")).toBe(true);
  });

  it("leaves a tls rule's passthrough alone, which is judged on the SNI", () => {
    const result = detect({ ...FULL });
    expect(result).toMatch(/set-var\(txn\.pass\) int\(1\) if tls0_sni tls0_port sni_is_name\n/);
  });

  it("declares nothing without an ip rule", () => {
    const result = detect({ tlsRules: FULL.tlsRules });
    expect(result.includes("dns_routed")).toBe(false);
    expect(result.includes("ip_dst_internal")).toBe(false);
  });

  it("refuses a passthrough to the proxy's own listener, and only there", () => {
    // 0.0.0.0/0 covers the proxy's other addresses, which would loop it into
    // itself; an outside host's 10024 is still the rule's to allow.
    const result = detect({ ipRules: ["0.0.0.0/0:*"] });
    expect(result.includes(`acl ip_dst_internal dst -m ip ${INTERNAL_RANGES.join(" ")}`)).toBe(
      true,
    );
    const self = "{ var(txn.pass) -m found } ip_dst_internal { dst_port 10024 }";
    expect(result.includes(`set-var(txn.reason) str(internal-address) if ${self}\n`)).toBe(true);
    expect(result.includes(`tcp-request content reject if ${self}\n`)).toBe(true);
  });
});

reportResults();

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
    hasResolver: true,
    internalAddrs: INTERNAL_RANGES,
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
    // txn.tlsrule is gated on the port as well as the SNI. From the SNI alone,
    // an SNI matching db.example.com on a port the rule does not name would
    // still trigger do-resolve/set-dst here, overwriting the connection's
    // destination before the inspected path ever sees it, even though txn.pass
    // (gated on sni+port together) correctly never fires for it.
    expect(config.includes("set-var(txn.tlsrule) int(1) if tls0_sni tls0_port")).toBe(true);
  });

  it("runs every content rule before the accept that ends the content rules' evaluation", () => {
    // `tcp-request content accept` stops the rest of the content rules, so a
    // set-var or do-resolve placed after it never runs, silently, with the
    // passthrough still working but going to the client's own address.
    const resolve = config.indexOf("tcp-request content do-resolve");
    const accept = config.indexOf("tcp-request content accept");
    expect(resolve !== -1 && resolve < accept).toBe(true);
  });

  it("connects a passthrough where it resolved the SNI, not where the client aimed", () => {
    // Not decrypting is no reason to let the client pick the destination: a
    // ClientHello carrying an allowed name could otherwise be sent anywhere,
    // turning any TLS rule into a raw tunnel to an address of the build's
    // choosing.
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
    // order, so a use_backend above the accept is only misleading, and
    // HAProxy warns about it.
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
  it("gates the tlsrule flag on the SNI alone", () => {
    const anyPort = detect({ tlsRules: ["db.example.com:*"] });
    expect(anyPort).toMatch(/set-var\(txn\.tlsrule\) int\(1\) if tls0_sni\n/);
  });
});

reportResults();

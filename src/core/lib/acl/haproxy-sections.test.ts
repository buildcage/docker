import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import { preamble, resolversSection, originBackends } from "./haproxy-sections.ts";

function last(section: readonly string[]): string {
  return section[section.length - 1];
}

describe("section boundaries", () => {
  it("ends each section with the blank line that separates it from the next", () => {
    // generateHaproxyConfig joins the sections with nothing between them, so a
    // section stopping at its last directive would run that directive into the
    // next section's heading.
    expect(last(preamble({ global: [], defaults: [] }))).toBe("");
    expect(last(resolversSection())).toBe("");
    expect(last(originBackends("/etc/ssl/certs/ca-certificates.crt"))).toBe("");
  });
});

describe("defaults", () => {
  it("keeps an idle tunnel open past the client and server timeouts", () => {
    expect(preamble({ global: [], defaults: [] }).includes("    timeout tunnel 1h")).toBe(true);
  });
});

describe("the origin backends", () => {
  it("verifies against the CA file it is given, not one of its own", () => {
    // Every test that goes through generateHaproxyConfig runs with the default
    // path, which a hardcoded one would satisfy just as well.
    expect(originBackends("/tmp/other-ca.pem").filter((l) => l.includes("ca-file"))).toStrictEqual([
      "    server origin 0.0.0.0 ssl verify required ca-file /tmp/other-ca.pem " +
        "sni var(txn.host)",
      "    server origin 0.0.0.0 ssl verify required ca-file /tmp/other-ca.pem " +
        "sni var(txn.host) alpn h2,http/1.1",
    ]);
  });

  it("lets a gRPC call outlast the server timeout on the h2 backend", () => {
    const backends = originBackends("/etc/ssl/certs/ca-certificates.crt");
    const h2 = backends.slice(backends.indexOf("backend origin_tls_h2"));
    expect(h2[2]).toBe(
      "    http-request set-timeout server 1h if { req.hdr(content-type) -m beg application/grpc }",
    );
  });
});

reportResults();

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

describe("the preamble", () => {
  const lines = preamble({ global: [], defaults: [] });

  it("drops to an unprivileged user", () => {
    expect(lines).toContain("    user haproxy");
    expect(lines).toContain("    group haproxy");
  });

  it("states the resolver's address family, leaving it nothing to read off the host", () => {
    expect(lines).toContain("    dns-accept-family ipv4");
  });

  it("sizes a log line for the longest request it accepts", () => {
    // A cut line matches nothing, so the event it carried leaves no trace. The
    // token order is load-bearing: the other one is rejected outright.
    expect(lines).toContain("    log stdout len 16384 format raw local0");
  });

  it("writes every line from one thread", () => {
    // Threads sharing the stdout fd drop lines, and one dropped line marks the
    // report incomplete.
    expect(lines.filter((l) => l.trim().startsWith("nbthread"))).toStrictEqual(["    nbthread 1"]);
  });

  it("exposes readiness on a unix socket, out of reach of the firewall", () => {
    // s6-notifyoncheck polls this; a TCP health port would depend on what
    // init-iptables allows, and a blocked check never signals ready.
    expect(lines).toContain("    bind /var/run/haproxy-health.sock mode 666");
    expect(lines).toContain("    monitor-uri /health");
  });
});

describe("the resolver", () => {
  it("resolves through the container's own resolv.conf, not a public resolver", () => {
    expect(resolversSection()).toContain("    parse-resolv-conf");
    expect(resolversSection().join("\n")).not.toContain("nameserver");
  });

  it("accepts an answer past the 512-byte default, which would resolve nothing", () => {
    // An internal zone often serves enough records to pass it, and a
    // truncated answer is no answer at all.
    expect(resolversSection()).toContain("    accepted_payload_size 8192");
  });
});

describe("defaults", () => {
  it("keeps an idle tunnel open past the client and server timeouts", () => {
    expect(preamble({ global: [], defaults: [] })).toContain("    timeout tunnel 1h");
  });
});

describe("the origin backends", () => {
  it("verifies against the CA file it is given, not one of its own", () => {
    // Every test that goes through generateHaproxyConfig runs with the default
    // path, which a hardcoded one would satisfy just as well.
    expect(originBackends("/tmp/other-ca.pem").filter((l) => l.includes("ca-file"))).toStrictEqual([
      "    server origin 0.0.0.0 ssl verify required ca-file /tmp/other-ca.pem " +
        "sni var(txn.host)",
    ]);
  });
});

reportResults();

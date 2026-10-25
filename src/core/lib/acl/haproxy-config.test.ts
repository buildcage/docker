import { PROXY_ADDRESS, PROXY_SUBNET } from "../log/proxy-address.ts";
import { FULL_RULES, section, seconds, timeout } from "../test/config-text.ts";
import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import { generateHaproxyConfig, type HaproxyConfigOptions } from "./haproxy-config.ts";
import { INTERNAL_RANGES } from "./haproxy-rules.ts";
import { buildUrlRules } from "./url-rules.ts";

function gen(options: Partial<HaproxyConfigOptions> = {}): string {
  return generateHaproxyConfig({ proxyAddress: PROXY_ADDRESS, ...options });
}

/** HAProxy's own per-line word cap (MAX_LINE_ARGS); it refuses to start past this. */
const MAX_LINE_WORDS = 64;

function longestLineWords(config: string): number {
  return config
    .split("\n")
    .reduce((most, line) => Math.max(most, line.trim().split(/\s+/).filter(Boolean).length), 0);
}

const STAGES = ["frontend https_in", "frontend http_in"];

const FULL_CONFIG = gen(FULL_RULES);

describe("the global section", () => {
  it("takes an extension's global lines, and none without one", () => {
    const extension = {
      requestRules: () => [],
      responseRules: () => [],
      global: ["    # extension global line"],
    };
    expect(section(gen({ ...FULL_RULES, extension }), "global")).toContain(
      "\n    # extension global line",
    );
    expect(FULL_CONFIG).not.toContain("extension global line");
  });

  it("asks every resolution for the address family the global setting queries", () => {
    // A do-resolve asking for a family the global setting never queries comes
    // back with nothing, so the two have to agree.
    expect(section(FULL_CONFIG, "global")).toContain("\n    dns-accept-family ipv4\n");
    const resolves = FULL_CONFIG.split("\n").filter((l) => l.includes("do-resolve("));
    expect(resolves.length).toBeGreaterThan(0);
    for (const line of resolves) expect(line).toContain(",ipv4)");
  });
});

describe("where a connection is sent", () => {
  it("resolves on every path rather than trusting the client", () => {
    // Missed on one, set-dst would never run there and the connection would
    // go wherever the client's own address said.
    for (const stage of STAGES) {
      const text = section(FULL_CONFIG, stage);
      expect(text).toContain("do-resolve(txn.dst,buildcage,ipv4) var(txn.host)");
      expect(text).toContain("http-request set-dst var(txn.dst)");
    }
    const detect = section(FULL_CONFIG, "frontend detect");
    expect(detect).toContain("tcp-request content do-resolve(txn.dst,buildcage,ipv4)");
    expect(detect).toContain("tcp-request content set-dst var(txn.dst)");
  });

  it("generates the leaf certificate on the TLS stage from the template, signed by the CA", () => {
    // Pointing the default at the CA makes the first handshake per name fail.
    expect(section(FULL_CONFIG, "frontend https_in")).toContain(
      "bind 127.0.0.1:10025 accept-proxy ssl crt /etc/haproxy/default.pem " +
        "generate-certificates ca-sign-file /etc/haproxy/ca.pem",
    );
  });
});

describe("the internal-address guard", () => {
  it("counts the built-in ranges, the proxy's network and the proxy's own address as internal", () => {
    // A name resolving to the proxy or to a step beside it is as internal as
    // any other range.
    const internal = [...INTERNAL_RANGES, PROXY_SUBNET, PROXY_ADDRESS].join(" ");
    for (const stage of STAGES) {
      expect(section(FULL_CONFIG, stage)).toContain(
        `\n    acl dst_internal var(txn.dst) -m ip ${internal}\n`,
      );
    }
    expect(section(FULL_CONFIG, "frontend detect")).toContain(
      `\n    acl pass_dst_internal var(txn.dst) -m ip ${internal}\n`,
    );
  });

  it("extends the internal set with the runner's own addresses at every guard site", () => {
    // RFC1918 is allowed on purpose for an internal mirror, so without this an
    // allowlisted name resolving to the runner reaches its published ports.
    const withHost = gen({ ...FULL_RULES, hostAddressFile: "/etc/haproxy/rules/host_addrs.lst" });
    const byFile = withHost
      .split("\n")
      .filter((l) => l.includes("-m ip -f /etc/haproxy/rules/host_addrs.lst"))
      .map((l) => l.trim().split(" ").slice(0, 3).join(" "));
    expect(byFile).toStrictEqual([
      "acl ip_dst_internal dst",
      "acl pass_dst_internal var(txn.dst)",
      "acl dst_internal var(txn.dst)",
      "acl dst_internal var(txn.dst)",
    ]);
  });

  it("emits no host-address acl when no file is given, rather than an unreadable path", () => {
    // Only setup's rule check leaves the file out, and it never starts HAProxy
    // on the result; inspect's init-cfg always writes one.
    expect(FULL_CONFIG).not.toContain("-m ip -f");
  });
});

describe("plaintext request timeout", () => {
  it("ends a silent client's wait before detect's client timeout does", () => {
    // detect's clock starts at the connection, http_in's only after the hand-off.
    const httpIn = section(FULL_CONFIG, "frontend http_in");
    const deadline =
      seconds(FULL_CONFIG, "timeout client") -
      seconds(section(FULL_CONFIG, "frontend detect"), "tcp-request inspect-delay");
    expect(seconds(httpIn, "timeout http-request") < deadline).toBe(true);
    expect(seconds(httpIn, "timeout http-keep-alive")).toBe(seconds(FULL_CONFIG, "timeout client"));
  });
});

describe("log lines", () => {
  it("puts the one field the build sizes at the end of every line it logs", () => {
    // Whatever cuts a line then costs the target's tail, not the decision.
    const formats = FULL_CONFIG.split("\n").filter((line) =>
      line.includes('log-format "buildcage'),
    );
    // error-log-format included.
    expect(formats.length).toBe(4);
    for (const line of formats) {
      expect(line.endsWith('%[var(txn.pathq)]"') || line.endsWith('sni=%[var(txn.sni)]"')).toBe(
        true,
      );
    }
  });
});

// HAProxy refuses to start on a line past MAX_LINE_ARGS words, so no rule
// count may push one over.
describe("line length", () => {
  it("decides with one line per rule, which no rule count can outgrow", () => {
    const rules = Array.from({ length: 40 }, (_, i) => `GET https://h${i}.example.com/pkg/**`);
    const config = gen({ urlRules: buildUrlRules(rules.join("\n")) });
    expect(config).toContain("-m bool } s39_host");
    expect(longestLineWords(config) <= MAX_LINE_WORDS).toBe(true);
  });

  it("flags a passthrough with one line per rule, which no rule count can outgrow", () => {
    const config = gen({
      tlsRules: Array.from({ length: 30 }, (_, i) => `h${i}.example.com:443`),
      ipRules: Array.from({ length: 30 }, (_, i) => `10.0.0.${i}:5432`),
    });
    expect(config).toContain("set-var(txn.pass) int(1) if tls29_sni tls29_port");
    expect(longestLineWords(config) <= MAX_LINE_WORDS).toBe(true);
  });

  it("keeps the internal guard off the line-length cliff however many host addresses there are", () => {
    // The point of the pattern file: addresses live in it, not on the acl line.
    const withHost = gen({ ...FULL_RULES, hostAddressFile: "/etc/haproxy/rules/host_addrs.lst" });
    expect(longestLineWords(withHost) <= MAX_LINE_WORDS).toBe(true);
  });
});

// audit records without enforcing, so it may not block anything.
describe("audit mode", () => {
  const audit = gen({ ...FULL_RULES, mode: "audit" });

  it("blocks nothing on either listener", () => {
    expect(audit).not.toContain("http-request deny unless");
    expect(audit).not.toContain("# No rules for this scheme");
  });

  it("still connects only where it resolved the name, on either listener", () => {
    for (const stage of STAGES) {
      expect(section(audit, stage)).toContain("http-request set-dst var(txn.dst)");
    }
  });
});

describe("idle timeouts", () => {
  it("closes a half-closed connection at the client and server timeouts, not the tunnel's", () => {
    expect(timeout(FULL_CONFIG, "client-fin")).toBe(timeout(FULL_CONFIG, "client"));
    expect(timeout(FULL_CONFIG, "server-fin")).toBe(timeout(FULL_CONFIG, "server"));
  });
});

reportResults();

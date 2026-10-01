import { PROXY_ADDRESS, PROXY_SUBNET } from "../log/proxy-address.ts";
import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import { INTERNAL_RANGES } from "./haproxy-rules.ts";
import {
  generateUniversalHaproxyConfig,
  type UniversalHaproxyConfigOptions,
} from "./haproxy-universal-config.ts";
import { convertRule } from "./wildcard-rules.ts";

const HOST_FILE = "/etc/haproxy/rules/host_addrs.lst";

function gen(options: Partial<UniversalHaproxyConfigOptions> = {}) {
  return generateUniversalHaproxyConfig({
    proxyAddress: PROXY_ADDRESS,
    hostAddressFile: HOST_FILE,
    ...options,
  });
}

function lines(config: string): string[] {
  return config.split("\n").map((l) => l.trim());
}

/** The patterns of every `acl <name> ... -m reg -i <pattern>` line, unescaped. */
function patterns(config: string, name: string): string[] {
  const prefix = `acl ${name} `;
  return lines(config)
    .filter((l) => l.startsWith(prefix))
    .map((l) => l.slice(l.indexOf("-m reg -i ") + "-m reg -i ".length))
    .map((p) => p.replace(/\\([\\#'" ])/g, "$1"));
}

const HTTPS = [
  "github.com:443",
  "*.example.com:443",
  "**.example.org:*",
  "ex?mple.net:8443",
  "~^api[0-9]+\\.example\\.com:443$",
];
const HTTP = ["deb.debian.org:80", "*.ubuntu.com:*"];
const IP = ["10.0.0.5:5432", "172.16.0.0/12:*", "192.168.*.*:22", "~^10\\.1\\.[0-9]+:6379$"];

describe("rule lists", () => {
  const config = gen({ httpsRules: HTTPS, httpRules: HTTP, ipRules: IP }).config;

  it("matches each rule with the regex convertRule gives it", () => {
    // Setup validates rules with convertRule, so this is the regex each rule
    // has always been matched with.
    expect(patterns(config, "is_https_allowed")).toStrictEqual(HTTPS.map(convertRule));
    expect(patterns(config, "is_http_allowed")).toStrictEqual(HTTP.map(convertRule));
    expect(patterns(config, "is_ip_match")).toStrictEqual(IP.map(convertRule));
  });

  it("escapes a backslash for the config parser", () => {
    expect(
      lines(config).includes(
        "acl is_https_allowed var(txn.sni_port) -m reg -i ^api[0-9]+\\\\.example\\\\.com:443$",
      ),
    ).toBe(true);
  });

  it("names the rule each acl line came from", () => {
    const all = lines(config);
    const at = all.indexOf("# **.example.org:*");
    expect(all[at + 1]).toBe(
      "acl is_https_allowed var(txn.sni_port) -m reg -i ^.+\\\\.example\\\\.org:\\\\d+$",
    );
  });

  it("matches nothing for a list with no rules", () => {
    const empty = lines(gen().config);
    for (const name of ["is_ip_match", "is_https_allowed", "is_http_allowed"]) {
      expect(empty.filter((l) => l.startsWith(`acl ${name} `))).toStrictEqual([
        `acl ${name} always_false`,
      ]);
    }
  });

  it("refuses a wildcard inside a label, as setup does", () => {
    expect(() => gen({ httpsRules: ["a*b.example.com:443"] })).toThrow("mixes");
  });

  it("ignores an IP rule it cannot match, with a warning", () => {
    const { config: withBad, warnings } = gen({ ipRules: ["10.0.0.1", "10.0.0.2:22"] });
    expect(patterns(withBad, "is_ip_match")).toStrictEqual(["^10\\.0\\.0\\.2:22$"]);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch("has no port");
  });
});

describe("audit", () => {
  const { config, warnings } = gen({
    mode: "audit",
    httpsRules: ["a*b.example.com:443"],
    ipRules: ["10.0.0.1"],
  });

  it("lets every list match anything, without compiling the rules", () => {
    for (const name of ["is_ip_match", "is_https_allowed", "is_http_allowed"]) {
      expect(patterns(config, name)).toStrictEqual([".*"]);
    }
    expect(warnings).toStrictEqual([]);
  });

  it("logs AUDIT where restrict logs ALLOWED", () => {
    expect(config.includes("str(ALLOWED)")).toBe(false);
    expect(lines(config).filter((l) => l.includes("str(AUDIT)")).length).toBe(3);
    expect(lines(gen().config).filter((l) => l.includes("str(ALLOWED)")).length).toBe(3);
  });

  it("accepts an unmatched IP connection only in audit", () => {
    const accept = "tcp-request content accept if !is_dns_routed !is_ip_match";
    expect(lines(config).includes(accept)).toBe(true);
    expect(lines(gen().config).includes(accept)).toBe(false);
  });
});

describe("resolver", () => {
  it("uses the upstreams it is given", () => {
    const config = gen({ resolverAddress: ["1.1.1.1", "8.8.8.8"] }).config;
    expect(config.includes("    nameserver ns1 1.1.1.1:53\n    nameserver ns2 8.8.8.8:53\n")).toBe(
      true,
    );
    expect(config.includes("parse-resolv-conf")).toBe(false);
  });

  it("reads /etc/resolv.conf when given none", () => {
    const config = gen().config;
    expect(lines(config).includes("parse-resolv-conf")).toBe(true);
    expect(config.includes("nameserver")).toBe(false);
  });

  it("retries a failed resolution on the path no inspect-delay caps", () => {
    // Without the second call one transient miss refuses a name the rules
    // allow; without its guard a destination already found is re-resolved.
    const resolves = lines(gen().config).filter((l) => l.startsWith("http-request do-resolve("));
    expect(resolves.length).toBe(2);
    expect(resolves[1].endsWith("unless { var(txn.dst) -m found }")).toBe(true);
  });
});

describe("internal-address guard", () => {
  // An IP rule naming a metadata address must not open it to a name.
  const config = gen({ ipRules: ["169.254.169.254:80"] }).config;

  for (const name of ["dst_internal", "dst_internal_http"]) {
    it(`${name} covers INTERNAL_RANGES, the proxy's network and the runner's addresses`, () => {
      expect(lines(config).filter((l) => l.startsWith(`acl ${name} `))).toStrictEqual([
        `acl ${name} var(txn.dst) -m ip ${[...INTERNAL_RANGES, PROXY_SUBNET].join(" ")}`,
        `acl ${name} var(txn.dst) -m ip -f ${HOST_FILE}`,
      ]);
    });
  }
});

describe("outbound_proxy", () => {
  const all = lines(gen().config);

  it("recognises a connection that came through a name by the proxy's address", () => {
    expect(all.includes(`acl is_dns_routed dst ${PROXY_ADDRESS}`)).toBe(true);
  });

  it("matches IP rules against a variable set once, from dst", () => {
    // An acl is evaluated where it is used, so a variable a later line
    // overwrites with the SNI would let the client pick what is matched.
    expect(all.filter((l) => /set-var(-fmt)?\(txn\.dst_target\)/.test(l))).toStrictEqual([
      "tcp-request content set-var-fmt(txn.dst_target) %[dst]:%[dst_port]",
    ]);
  });

  it("refuses an SNI that is not a hostname before the allowlist or the resolver acts on it", () => {
    const reject = all.indexOf("tcp-request content reject if is_tls has_sni !sni_is_name");
    expect(reject !== -1).toBe(true);
    expect(
      reject < all.indexOf("tcp-request content reject if is_tls has_sni !is_https_allowed"),
    ).toBe(true);
    expect(reject < all.findIndex((l) => l.startsWith("tcp-request content do-resolve"))).toBe(
      true,
    );
  });
});

describe("plaintext request timeout", () => {
  it("ends a silent client's wait before outbound_proxy's client timeout does", () => {
    // outbound_proxy's clock starts at the connection, http_in's only after the
    // hand-off.
    const config = gen().config;
    const seconds = (directive: string, text = config) => {
      const [, n, unit] = new RegExp(`${directive} (\\d+)(s|m)\\n`).exec(text)!;
      return Number(n) * (unit === "m" ? 60 : 1);
    };
    const httpIn = config.slice(config.indexOf("frontend http_in\n"));
    const deadline = seconds("timeout client") - seconds("tcp-request inspect-delay");
    expect(seconds("timeout http-request", httpIn) < deadline).toBe(true);
    expect(seconds("timeout http-keep-alive", httpIn)).toBe(seconds("timeout client"));
  });
});

reportResults();

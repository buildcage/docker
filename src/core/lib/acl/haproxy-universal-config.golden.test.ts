/**
 * Full-text golden coverage of the `universal` engine's haproxy.cfg, rendered
 * the way init-haproxy-cfg does: envsubst over haproxy.cfg.template, plus the
 * rule lists convert-rule.js writes beside it, appended to the fixture.
 *
 * vitest-only (see test/golden.node.ts).
 */
import { readFileSync } from "node:fs";

import { describe, it } from "vitest";

import { expectMatchesGolden } from "../test/golden.node.ts";
import { buildRules } from "./wildcard-rules.ts";

interface UniversalCase {
  mode: "restrict" | "audit";
  httpsRules: string[];
  httpRules: string[];
  ipRules: string[];
  /** EXTERNAL_RESOLVER; empty means /etc/resolv.conf. */
  resolverAddress: string[];
}

const NONE = { httpsRules: [], httpRules: [], ipRules: [], resolverAddress: [] };

const CASES: Record<string, UniversalCase> = {
  // Nothing allowed, resolving through /etc/resolv.conf.
  "restrict-empty": { mode: "restrict", ...NONE },

  // Every wildcard shape, a raw regex and a port wildcard on each rule kind,
  // with IP rules as an address, CIDR blocks, octet wildcards and a regex.
  "restrict-full": {
    mode: "restrict",
    httpsRules: [
      "github.com:443",
      "*.example.com:443",
      "**.example.org:*",
      "ex?mple.net:8443",
      "~^api[0-9]+\\.example\\.com:443$",
      "~^(a|b)\\.example\\.io:\\d+$",
    ],
    httpRules: ["deb.debian.org:80", "*.ubuntu.com:*"],
    ipRules: [
      "10.0.0.5:5432",
      "10.0.0.0/8:443",
      "172.16.0.0/12:*",
      "192.168.*.*:22",
      "10.**:80",
      "~^10\\.1\\.[0-9]+\\.[0-9]+:6379$",
    ],
    resolverAddress: ["1.1.1.1", "8.8.8.8"],
  },

  // The same rules in audit, where they allow nothing more than audit already
  // does.
  "audit-full": {
    mode: "audit",
    httpsRules: ["github.com:443", "*.example.com:443"],
    httpRules: ["deb.debian.org:80"],
    ipRules: ["10.0.0.0/8:443"],
    resolverAddress: ["1.1.1.1"],
  },

  // audit with no rules and the container's own resolver.
  "audit-resolv-conf": { mode: "audit", ...NONE },

  // One rule kind at a time, so an empty list beside a full one shows too.
  "restrict-https-only": {
    mode: "restrict",
    ...NONE,
    httpsRules: ["registry.npmjs.org:443"],
  },
};

const TEMPLATE = readFileSync(
  new URL("../../../../docker/universal/files/haproxy.cfg.template", import.meta.url),
  "utf8",
);

/** What convert-rule.js prints for one rules input. */
function ruleList(c: UniversalCase, rules: string[]): string {
  if (c.mode === "audit") return ".*\n";
  const regexes = buildRules(rules.join(" "));
  return regexes.length > 0 ? `${regexes.join("\n")}\n` : "";
}

/** init-haproxy-cfg's envsubst, with the values it computes. */
function render(c: UniversalCase): string {
  const nameservers =
    c.resolverAddress.length === 0
      ? "\n    parse-resolv-conf"
      : c.resolverAddress.map((ip, i) => `\n    nameserver ns${i + 1} ${ip}:53`).join("");
  const config = TEMPLATE.replaceAll("${HAPROXY_NAMESERVERS}", nameservers)
    .replaceAll("${HAPROXY_DECISION_LABEL}", c.mode === "audit" ? "AUDIT" : "ALLOWED")
    .replaceAll(
      "${HAPROXY_AUDIT_ACCEPT}",
      c.mode === "audit"
        ? "tcp-request content accept if !is_dns_routed !is_ip_match"
        : "# restrict mode: reject unmatched IPs below",
    );
  const lists = [
    ["allowed_https.lst", c.httpsRules],
    ["allowed_http.lst", c.httpRules],
    ["allowed_ips.lst", c.ipRules],
  ] as const;
  return [
    config,
    ...lists.map(
      ([file, rules]) => `==> /etc/haproxy/rules/${file} <==\n${ruleList(c, [...rules])}`,
    ),
  ].join("");
}

describe("universal haproxy.cfg golden files", () => {
  for (const [name, c] of Object.entries(CASES)) {
    it(`matches __fixtures__/haproxy-universal/${name}.cfg`, () => {
      expectMatchesGolden(
        render(c),
        new URL(`./__fixtures__/haproxy-universal/${name}.cfg`, import.meta.url),
      );
    });
  }
});

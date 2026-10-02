/**
 * Full-text golden coverage of generateUniversalHaproxyConfig.
 *
 * vitest-only (see test/golden.node.ts).
 */
import { describe, it } from "vitest";

import { PROXY_ADDRESS } from "../log/proxy-address.ts";
import { expectMatchesGolden } from "../test/golden.node.ts";
import { generateUniversalHaproxyConfig } from "./haproxy-universal-config.ts";

interface UniversalCase {
  mode: "restrict" | "audit";
  httpsRules: string[];
  httpRules: string[];
  ipRules: string[];
}

const NONE = { httpsRules: [], httpRules: [], ipRules: [] };

const CASES: Record<string, UniversalCase> = {
  // Nothing allowed.
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
  },

  // The same rules in audit, where they allow nothing more than audit already
  // does.
  "audit-full": {
    mode: "audit",
    httpsRules: ["github.com:443", "*.example.com:443"],
    httpRules: ["deb.debian.org:80"],
    ipRules: ["10.0.0.0/8:443"],
  },

  // audit with no rules.
  "audit-empty": { mode: "audit", ...NONE },

  // One rule kind at a time, so an empty list beside a full one shows too.
  "restrict-https-only": {
    mode: "restrict",
    ...NONE,
    httpsRules: ["registry.npmjs.org:443"],
  },
};

describe("universal haproxy.cfg golden files", () => {
  for (const [name, c] of Object.entries(CASES)) {
    it(`matches __fixtures__/haproxy-universal/${name}.cfg`, () => {
      expectMatchesGolden(
        generateUniversalHaproxyConfig({
          ...c,
          proxyAddress: PROXY_ADDRESS,
          hostAddressFile: "/etc/haproxy/rules/host_addrs.lst",
        }),
        new URL(`./__fixtures__/haproxy-universal/${name}.cfg`, import.meta.url),
      );
    });
  }
});

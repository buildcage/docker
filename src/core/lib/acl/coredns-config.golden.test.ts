/**
 * Full-text golden coverage of generateCorednsConfig, for the same reason as
 * haproxy-config.golden.test.ts. The Corefile decides which names resolve at
 * all, so a silently reordered view block matters as much as a wrong one.
 */
import { describe, it } from "vitest";

import { expectMatchesGolden } from "../test/golden.node.ts";
import { generateCorednsConfig, type CorednsConfigOptions } from "./coredns-config.ts";
import { compileRuleSet, type RuleInputs } from "./haproxy-rules.ts";
import { buildUrlRules } from "./url-rules.ts";

const PROXY = "198.19.255.1";

const CASES: Record<string, RuleInputs & Partial<CorednsConfigOptions>> = {
  // Nothing but the proxy address: the skeleton, refusing every name.
  "restrict-empty": { proxyAddress: PROXY },

  "restrict-basic": {
    httpsRules: ["a.example.com:443"],
    httpRules: ["b.example.com:80"],
    tlsRules: ["db.example.com:443"],
    proxyAddress: PROXY,
  },

  // audit answers for every name instead of refusing, so the view set differs.
  "audit-basic": {
    mode: "audit",
    httpsRules: ["a.example.com:443"],
    httpRules: ["b.example.com:80"],
    tlsRules: ["db.example.com:443"],
    proxyAddress: PROXY,
  },

  // Only the host half of a URL rule reaches the resolver.
  "restrict-url-rules": {
    urlRules: buildUrlRules(
      [
        "GET https://a.example.com/x",
        "POST https://b.example.com:8443/y",
        "GET http://c.example.com/z",
      ].join("\n"),
    ),
    proxyAddress: PROXY,
  },

  "restrict-wildcards": {
    httpsRules: ["*.example.com:443", "**.example.org:*"],
    urlRules: buildUrlRules("GET ~^https://c\\.example\\.com:8443/x$"),
    proxyAddress: PROXY,
  },

  // A non-default TTL, which every synthesised answer carries.
  "restrict-ttl": {
    httpsRules: ["a.example.com:443"],
    proxyAddress: PROXY,
    ttlSeconds: 30,
  },
};

describe("generateCorednsConfig golden files", () => {
  for (const [name, { httpsRules, httpRules, tlsRules, urlRules, ...options }] of Object.entries(
    CASES,
  )) {
    it(`matches __fixtures__/coredns/${name}.conf`, () => {
      expectMatchesGolden(
        generateCorednsConfig(compileRuleSet({ httpsRules, httpRules, tlsRules, urlRules }), {
          ...options,
          proxyAddress: options.proxyAddress ?? PROXY,
        }).config,
        new URL(`./__fixtures__/coredns/${name}.conf`, import.meta.url),
      );
    });
  }
});

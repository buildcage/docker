/**
 * Full-text golden coverage of generateHaproxyConfig.
 *
 * haproxy-config.test.ts asserts on individual directives, which is what
 * catches a wrong one. These fix the whole file instead, so a change that
 * moves a section, reorders two ACLs or drops a line nothing asserts on still
 * shows up. Between them they reach every branch the options expose: both
 * modes, both resolver styles, each rule kind, and the host-address file.
 *
 * vitest-only (see test/golden.node.ts), so this file is kept out of the qjs test
 * bundle by rolldown.scripts.config.js's *.golden.test.ts exclude.
 */
import { describe, it } from "vitest";

import { expectMatchesGolden } from "../test/golden.node.ts";
import { generateHaproxyConfig, type HaproxyConfigOptions } from "./haproxy-config.ts";
import { buildUrlRules } from "./url-rules.ts";

const PROXY = "198.19.255.1";

const CASES: Record<string, HaproxyConfigOptions> = {
  // No options at all: the static skeleton every other case is a delta from.
  defaults: {},

  // One rule of every kind, resolving through named upstreams.
  "restrict-full": {
    httpsRules: ["a.example.com:443"],
    httpRules: ["b.example.com:80"],
    ipRules: ["10.0.0.5:5432"],
    tlsRules: ["db.example.com:443"],
    resolverAddress: ["1.1.1.1", "8.8.8.8"],
    proxyAddress: PROXY,
  },

  // Same rules, nothing refused, so the mode branch runs through every stage.
  "audit-full": {
    mode: "audit",
    httpsRules: ["a.example.com:443"],
    httpRules: ["b.example.com:80"],
    ipRules: ["10.0.0.5:5432"],
    tlsRules: ["db.example.com:443"],
    resolverAddress: ["1.1.1.1", "8.8.8.8"],
    proxyAddress: PROXY,
  },

  // Method + path matching, which is the inspect engine's whole reason to exist.
  "restrict-url-rules": {
    urlRules: buildUrlRules(
      [
        "GET https://a.example.com/pkg.json",
        "GET https://a.example.com/pkg/**",
        "POST https://b.example.com:8443/upload/*",
        "GET ~^https://c\\.example\\.com/[0-9]+$",
        "GET https://169.254.169.254/latest/meta-data/*",
      ].join("\n"),
    ),
    resolverAddress: ["1.1.1.1"],
    proxyAddress: PROXY,
  },

  // The other resolver style: the container's own /etc/resolv.conf.
  "restrict-resolv-conf": {
    httpsRules: ["a.example.com:443"],
    useResolvConf: true,
    proxyAddress: PROXY,
  },

  // The internal-destination guard's file-backed half.
  "restrict-host-address-file": {
    httpsRules: ["a.example.com:443"],
    resolverAddress: ["1.1.1.1"],
    proxyAddress: PROXY,
    hostAddressFile: "/etc/haproxy/host-addrs.lst",
  },

  // Every wildcard shape plus a raw regex, which pick different matchers.
  "restrict-wildcards": {
    httpsRules: ["*.example.com:443", "**.example.org:*", "plain.example.net:443"],
    tlsRules: ["~^db[0-9]+\\.example\\.com$:5432"],
    resolverAddress: ["1.1.1.1"],
    proxyAddress: PROXY,
  },

  // No resolver at all: nothing is resolved, so the do-resolve path is absent.
  "restrict-no-resolver": {
    httpsRules: ["a.example.com:443"],
    ipRules: ["10.0.0.5:5432"],
  },
};

describe("generateHaproxyConfig golden files", () => {
  for (const [name, options] of Object.entries(CASES)) {
    it(`matches __fixtures__/haproxy/${name}.cfg`, () => {
      expectMatchesGolden(
        generateHaproxyConfig(options).config,
        new URL(`./__fixtures__/haproxy/${name}.cfg`, import.meta.url),
      );
    });
  }
});

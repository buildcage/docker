/**
 * Generate the `inspect` engine's haproxy.cfg and Corefile from one rule set,
 * so what CoreDNS logs as allowed and what HAProxy actually lets through
 * cannot drift apart: a narrower view would misreport an allowed name as
 * denied, a wider one would misreport a denied name as allowed. CoreDNS never
 * resolves a name for real either way; only HAProxy does, and only once a
 * request has already passed these same rules.
 *
 * Usage:
 *   qjs --std -m gen-configs.js <haproxy_out> <corefile_out> <proxy_address> \
 *     <upstream_resolvers> <mode> <https_rules> <http_rules> <ip_rules> \
 *     <tls_rules> <url_rules>
 *
 * Host and IP rules are whitespace separated, URL rules newline separated
 * (each carries a method and a space).
 */
import * as std from "qjs:std";
import { generateHaproxyConfig } from "#core/lib/acl/haproxy-config.js";
import { generateCorednsConfig } from "#core/lib/acl/coredns-config.js";
import { buildUrlRules } from "#core/lib/acl/url-rules.js";
import { splitRuleTokens } from "#core/lib/acl/wildcard-rules.js";

const [
  haproxyOut,
  corefileOut,
  proxyAddress,
  upstreamsInput,
  mode,
  httpsInput,
  httpInput,
  ipInput,
  tlsInput,
  urlInput,
] = scriptArgs.slice(1);

function writeFile(path: string, content: string): void {
  const file = std.open(path, "w");
  if (!file) throw new Error(`cannot write ${path}`);
  file.puts(content);
  file.close();
}

try {
  if (!proxyAddress) throw new Error("no proxy address given");

  const upstreams = splitRuleTokens(upstreamsInput);
  if (upstreams.length === 0) throw new Error("no upstream resolver given");

  const httpsRules = splitRuleTokens(httpsInput);
  const httpRules = splitRuleTokens(httpInput);
  const ipRules = splitRuleTokens(ipInput);
  const tlsRules = splitRuleTokens(tlsInput);
  const urlRules = buildUrlRules(urlInput);

  const haproxy = generateHaproxyConfig({
    httpsRules,
    httpRules,
    ipRules,
    tlsRules,
    urlRules,
    mode: mode === "audit" ? "audit" : "restrict",
    resolverAddress: upstreams,
    proxyAddress,
  });
  const coredns = generateCorednsConfig({
    httpsRules,
    httpRules,
    tlsRules,
    urlRules,
    proxyAddress,
    mode: mode === "audit" ? "audit" : "restrict",
  });

  // A warning here means a rule cannot be honoured in full, so it has to be
  // visible in the build log rather than only in a file nobody reads.
  for (const warning of [...haproxy.warnings, ...coredns.warnings]) {
    std.err.puts(`buildcage: warning: ${warning}\n`);
  }

  writeFile(haproxyOut, haproxy.config);
  writeFile(corefileOut, coredns.config);
} catch (e) {
  // Failing closed: without both files the proxy would either not start or
  // start without an allowlist.
  std.err.puts(`buildcage: ${(e as Error).message}\n`);
  std.exit(1);
}

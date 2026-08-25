/**
 * Generate the `inspect` engine's haproxy.cfg and Corefile from one rule set,
 * so the proxy and resolver cannot describe different allowlists (a wider
 * resolver would let a build leak through a DNS query, a narrower one would
 * break permitted traffic).
 *
 * Usage:
 *   qjs --std -m gen-configs.js <haproxy_out> <corefile_out> <proxy_address> \
 *     <resolver_address> <upstream_resolvers> <mode> <https_rules> \
 *     <http_rules> <ip_rules> <tls_rules> <url_rules>
 *
 * The proxy and resolver share a container, so their addresses are the same;
 * kept as separate arguments to keep visible that the proxy must resolve
 * through the build's own resolver. Host and IP rules are whitespace separated,
 * URL rules newline separated (each carries a method and a space).
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
  resolverAddress,
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
    resolverAddress: resolverAddress || proxyAddress,
  });
  const coredns = generateCorednsConfig({
    httpsRules,
    httpRules,
    tlsRules,
    urlRules,
    proxyAddress,
    upstreams,
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

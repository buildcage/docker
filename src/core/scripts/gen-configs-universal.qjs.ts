/**
 * Generate the `universal` engine's haproxy.cfg and Corefile from one rule
 * set, so a name CoreDNS logs as allowed is one HAProxy would also let
 * through.
 *
 * Usage:
 *   qjs --std -m gen-configs.js <haproxy_out> <corefile_out> <proxy_address> \
 *     <host_address_file> <mode> <https_rules> <http_rules> <ip_rules>
 *
 * Rules are whitespace separated; `universal` has no url or tls rules. A name
 * is resolved against the container's own /etc/resolv.conf.
 */
import * as std from "qjs:std";

import { generateCorednsConfig } from "#core/lib/acl/coredns-config.js";
import { compileRuleSet } from "#core/lib/acl/haproxy-rules.js";
import { generateUniversalHaproxyConfig } from "#core/lib/acl/haproxy-universal-config.js";
import { splitRuleTokens } from "#core/lib/acl/wildcard-rules.js";

const [
  haproxyOut,
  corefileOut,
  proxyAddress,
  hostAddressFile,
  mode,
  httpsInput,
  httpInput,
  ipInput,
] = scriptArgs.slice(1);

function writeFile(path: string, content: string): void {
  const file = std.open(path, "w");
  if (!file) throw new Error(`cannot write ${path}`);
  file.puts(content);
  file.close();
}

try {
  if (!proxyAddress) throw new Error("no proxy address given");
  // init-cfg always writes the file, so a missing path is a caller
  // mismatch rather than an empty address list.
  if (!hostAddressFile) throw new Error("no host address file given");

  const httpsRules = splitRuleTokens(httpsInput);
  const httpRules = splitRuleTokens(httpInput);
  const proxyMode = mode === "audit" ? "audit" : "restrict";

  const haproxy = generateUniversalHaproxyConfig({
    mode: proxyMode,
    httpsRules,
    httpRules,
    ipRules: splitRuleTokens(ipInput),
    proxyAddress,
    hostAddressFile,
  });
  const coredns = generateCorednsConfig(compileRuleSet({ httpsRules, httpRules }), {
    proxyAddress,
    mode: proxyMode,
  });

  writeFile(haproxyOut, haproxy);
  writeFile(corefileOut, coredns);
} catch (e) {
  // Fail closed: without both files the proxy would either not start or
  // start without an allowlist.
  std.err.puts(`buildcage: ${(e as Error).message}\n`);
  std.exit(1);
}

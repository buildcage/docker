/**
 * Generate the `universal` engine's CoreDNS Corefile from the same host rules
 * the HAProxy allowlist is built from, so a name CoreDNS logs as allowed is one
 * HAProxy would also let through.
 *
 * `universal` templates haproxy.cfg with envsubst (init-haproxy-cfg), so only
 * the Corefile is generated here.
 *
 * Usage:
 *   qjs --std -m gen-coredns.js <corefile_out> <proxy_address> <mode> \
 *     <https_rules> <http_rules>
 *
 * Host rules are whitespace separated; `universal` has no url or tls rules.
 */
import * as std from "qjs:std";

import { generateCorednsConfig } from "#core/lib/acl/coredns-config.js";
import { compileRuleSet } from "#core/lib/acl/haproxy-rules.js";
import { splitRuleTokens } from "#core/lib/acl/wildcard-rules.js";

const [corefileOut, proxyAddress, mode, httpsInput, httpInput] = scriptArgs.slice(1);

function writeFile(path: string, content: string): void {
  const file = std.open(path, "w");
  if (!file) throw new Error(`cannot write ${path}`);
  file.puts(content);
  file.close();
}

try {
  if (!proxyAddress) throw new Error("no proxy address given");

  const httpsRules = splitRuleTokens(httpsInput);
  const httpRules = splitRuleTokens(httpInput);

  const coredns = generateCorednsConfig(compileRuleSet({ httpsRules, httpRules }), {
    proxyAddress,
    mode: mode === "audit" ? "audit" : "restrict",
  });

  // A warning means a rule cannot be honoured in full, so surface it in the
  // build log.
  for (const warning of coredns.warnings) {
    std.err.puts(`buildcage: warning: ${warning}\n`);
  }

  writeFile(corefileOut, coredns.config);
} catch (e) {
  // Fail closed: with no Corefile CoreDNS will not start, so the container
  // stops rather than run without an allowlist.
  std.err.puts(`buildcage: ${(e as Error).message}\n`);
  std.exit(1);
}

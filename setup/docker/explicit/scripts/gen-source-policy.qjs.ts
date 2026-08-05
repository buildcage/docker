/**
 * Generate a BuildKit source policy (protobuf-JSON) from the same rule inputs
 * used by transparent mode's HAProxy ACLs.
 *
 * Usage: qjs --std -m gen-source-policy.js <proxy_mode> <https_rules> <http_rules> <ip_rules>
 */
import * as std from "qjs:std";
import { buildSourcePolicy } from "#core/lib/acl/source-policy.js";

const [proxyMode, httpsRulesInput, httpRulesInput, ipRulesInput] = scriptArgs.slice(1);

try {
  const policy = buildSourcePolicy({ proxyMode, httpsRulesInput, httpRulesInput, ipRulesInput });
  std.out.puts(JSON.stringify(policy, null, 2) + "\n");
} catch (e) {
  std.err.puts(`${(e as Error).message}\n`);
  std.exit(1);
}

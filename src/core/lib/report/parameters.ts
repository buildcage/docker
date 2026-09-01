import { splitRuleTokens } from "../acl/wildcard-rules.ts";
import type { GenReportParameters } from "./types.ts";

/**
 * Builds GenReportParameters from a container's own env (as read via
 * docker inspect) or, for run, from an equivalent env-shaped record it
 * already holds in memory. Same env var names for both engines.
 */
export function buildReportParameters(
  env: Record<string, string | undefined>,
): GenReportParameters {
  return {
    mode: env.PROXY_MODE || "restrict",
    allowedHttpsRules: splitRuleTokens(env.ALLOWED_HTTPS_RULES),
    allowedHttpRules: splitRuleTokens(env.ALLOWED_HTTP_RULES),
    allowedIpRules: splitRuleTokens(env.ALLOWED_IP_RULES),
    allowTlsRules: splitRuleTokens(env.ALLOW_TLS_RULES),
    knownBlockedRules: splitRuleTokens(env.KNOWN_BLOCKED_RULES),
  };
}

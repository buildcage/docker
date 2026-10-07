import { buildUrlRules } from "#core/lib/acl/url-rules.ts";
import { splitKnownBlockedLines, splitRuleTokens } from "#core/lib/acl/wildcard-rules.ts";
import type { GenReportParameters } from "#core/lib/report/types.ts";

/** Builds GenReportParameters from a container's own env, as read via
 *  docker inspect. */
export function buildReportParameters(
  env: Record<string, string | undefined>,
): GenReportParameters {
  return {
    mode: env.PROXY_MODE || "restrict",
    allowedHttpsRules: splitRuleTokens(env.ALLOWED_HTTPS_RULES),
    allowedHttpRules: splitRuleTokens(env.ALLOWED_HTTP_RULES),
    allowedIpRules: splitRuleTokens(env.ALLOWED_IP_RULES),
    allowedTlsRules: splitRuleTokens(env.ALLOWED_TLS_RULES),
    allowedUrlRules: buildUrlRules(env.ALLOWED_URL_RULES).map((rule) => rule.raw),
    // Newline-separated, unlike the whitespace-separated allow inputs: a line
    // can be a URL rule carrying a space (see splitKnownBlockedLines).
    knownBlockedRules: splitKnownBlockedLines(env.KNOWN_BLOCKED_RULES),
  };
}

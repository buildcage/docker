import { ActionError, errorMessage } from "../errors.ts";
import { generateCorednsConfig } from "./coredns-config.ts";
import { generateHaproxyConfig } from "./haproxy-config.ts";
import { compileRuleSet, type RuleInputs } from "./haproxy-rules.ts";
import { generateUniversalHaproxyConfig } from "./haproxy-universal-config.ts";
import { isIpRuleAddress } from "./ipv4.ts";
import { buildUrlRules, type UrlRule } from "./url-rules.ts";
import { parseAndValidateKnownBlockedRules, parseAndValidateRules } from "./wildcard-rules.ts";

/**
 * Thrown when an ACL rule input (allowed_https_rules/allowed_http_rules/
 * allowed_ip_rules/known_blocked_rules) fails to parse. Shared by the setup
 * and run actions, which both accept the same rule syntax.
 */
export class InvalidRulesError extends ActionError<"INVALID_RULES"> {}

/**
 * Rethrow a rule-parser's syntax errors as an InvalidRulesError.
 */
export function parseRulesOrThrow(rulesInput: string | undefined): string[] {
  try {
    return parseAndValidateRules(rulesInput);
  } catch (e) {
    throw new InvalidRulesError(errorMessage(e), "INVALID_RULES");
  }
}

/**
 * Same, for `known_blocked_rules`, whose missing ports are completed rather
 * than rejected; see completeRulePort.
 */
export function parseKnownBlockedRulesOrThrow(rulesInput: string | undefined): string[] {
  try {
    return parseAndValidateKnownBlockedRules(rulesInput);
  } catch (e) {
    throw new InvalidRulesError(errorMessage(e), "INVALID_RULES");
  }
}

export function buildUrlRulesOrThrow(rulesInput: string | undefined): UrlRule[] {
  try {
    return buildUrlRules(rulesInput);
  } catch (e) {
    throw new InvalidRulesError(errorMessage(e), "INVALID_RULES");
  }
}

/** Only the container knows the real address; the generators just interpolate it. */
const PLACEHOLDER_PROXY_ADDRESS = "192.0.2.1";

/**
 * Compile already-parsed rules the way the proxy does when it starts, so a
 * rule its config generators refuse fails here rather than stopping the
 * container. A regex only HAProxy's PCRE2 or the resolver's RE2 refuses, such
 * as `[\d-z]`, still stops it. Runs every engine's compiler regardless of
 * proxy_engine.
 *
 * @throws {InvalidRulesError} if any compiler refuses a rule
 */
export function checkRulesCompileOrThrow(inputs: RuleInputs): void {
  try {
    generateHaproxyConfig({ ...inputs, proxyAddress: PLACEHOLDER_PROXY_ADDRESS });
    generateUniversalHaproxyConfig({
      ...inputs,
      proxyAddress: PLACEHOLDER_PROXY_ADDRESS,
      hostAddressFile: "/dev/null",
    });
    generateCorednsConfig(compileRuleSet(inputs), { proxyAddress: PLACEHOLDER_PROXY_ADDRESS });
  } catch (e) {
    throw new InvalidRulesError(errorMessage(e), "INVALID_RULES");
  }
}

/**
 * An IP rule's host half, for a rule not written as a `~` regex: digits, dots
 * and wildcards, plus the `/` of a CIDR block. Anything else names a host,
 * and the IP path matches only the address a connection goes to.
 */
const IP_RULE_HOST = /^[0-9.*?/]+$/;

/**
 * parseRulesOrThrow for `allowed_ip_rules`, which also refuses a rule that
 * names a host rather than an address.
 */
export function parseIpRulesOrThrow(rulesInput: string | undefined): string[] {
  const rules = parseRulesOrThrow(rulesInput);
  for (const rule of rules) {
    if (rule.startsWith("~")) continue;
    const host = rule.slice(0, rule.lastIndexOf(":"));
    if (!IP_RULE_HOST.test(host)) {
      throw new InvalidRulesError(
        `IP rule "${rule}" names a host, not an address. allowed_ip_rules is matched against ` +
          `the address a connection goes to; allow a name with allowed_https_rules or ` +
          `allowed_http_rules instead.`,
        "INVALID_RULES",
      );
    }
    if (!isIpRuleAddress(host)) {
      throw new InvalidRulesError(
        `IP rule "${rule}" is not an IPv4 address: write four octets, each a decimal from 0 to ` +
          `255 without a leading zero (10.0.0.1, not 010.0.0.1) or a wildcard (10.0.*.*, or ` +
          `10.** across dots), and a CIDR prefix from 0 to 32.`,
        "INVALID_RULES",
      );
    }
  }
  return rules;
}

export interface BuildACLRulesInput {
  httpsRulesInput: string | undefined;
  httpRulesInput: string | undefined;
  ipRulesInput: string | undefined;
}

export interface ACLRules {
  httpsRules: string[];
  httpRules: string[];
  ipRules: string[];
}

/**
 * Rules are kept as written (wildcard format) and validated eagerly.
 */
export function buildACLRules({
  httpsRulesInput,
  httpRulesInput,
  ipRulesInput,
}: BuildACLRulesInput): ACLRules {
  return {
    httpsRules: parseRulesOrThrow(httpsRulesInput),
    httpRules: parseRulesOrThrow(httpRulesInput),
    ipRules: parseIpRulesOrThrow(ipRulesInput),
  };
}

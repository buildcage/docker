import { ActionError, errorMessage } from "../errors.ts";
import { parseAndValidateRules } from "./wildcard-rules.ts";

/**
 * Thrown when an ACL rule input (allowed_https_rules/allowed_http_rules/
 * allowed_ip_rules/known_blocked_rules) fails to parse — shared by the
 * setup and run actions, which both accept the same rule syntax.
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
 * Build ACL rules from input strings. Rules are passed through as-is
 * (wildcard format), validated eagerly.
 */
export function buildACLRules({
  httpsRulesInput,
  httpRulesInput,
  ipRulesInput,
}: BuildACLRulesInput): ACLRules {
  return {
    httpsRules: parseRulesOrThrow(httpsRulesInput),
    httpRules: parseRulesOrThrow(httpRulesInput),
    ipRules: parseRulesOrThrow(ipRulesInput),
  };
}

import * as core from "@actions/core";

import {
  buildACLRules,
  buildUrlRulesOrThrow,
  checkRulesCompileOrThrow,
  parseKnownBlockedRulesOrThrow,
  parseRulesOrThrow,
} from "#core/lib/acl/rules.ts";

import type { GetInput } from "./inputs.ts";

export interface RuleInputs {
  httpsRules: string[];
  httpRules: string[];
  ipRules: string[];
  /** The raw text of each compiled URL rule, not the compiled form: only the
   *  proxy re-compiles them, and only inspect enforces them. */
  urlRules: string[];
  tlsRules: string[];
  knownBlockedRules: string[];
}

/**
 * Parse and validate every rule input.
 *
 * URL and TLS rules are compiled here even on an engine that ignores them,
 * purely so a typo fails before the proxy starts rather than silently inside
 * it. Everything is then compiled once more the way the proxy does it, so a
 * rule this parser accepts but the proxy refuses fails here too.
 *
 * The statement order is the order a malformed-rule error surfaces in, so it
 * is deliberate rather than incidental.
 *
 * @throws {InvalidRulesError} if any rule is malformed
 */
export function readRuleInputs(getInput: GetInput = core.getInput): RuleInputs {
  const rules = buildACLRules({
    httpsRulesInput: getInput("allowed_https_rules"),
    httpRulesInput: getInput("allowed_http_rules"),
    ipRulesInput: getInput("allowed_ip_rules"),
  });
  const knownBlockedRules = parseKnownBlockedRulesOrThrow(getInput("known_blocked_rules"));
  const urlRulesInput = getInput("allowed_url_rules");
  const tlsRules = parseRulesOrThrow(getInput("allowed_tls_rules"));
  const compiledUrlRules = buildUrlRulesOrThrow(urlRulesInput);
  checkRulesCompileOrThrow({ ...rules, tlsRules, urlRules: compiledUrlRules });
  const urlRules = compiledUrlRules.map((r) => r.raw);

  return {
    httpsRules: rules.httpsRules,
    httpRules: rules.httpRules,
    ipRules: rules.ipRules,
    urlRules,
    tlsRules,
    knownBlockedRules,
  };
}

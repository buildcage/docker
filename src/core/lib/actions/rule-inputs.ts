import * as core from "@actions/core";

import {
  buildACLRules,
  buildUrlRulesOrThrow,
  checkRulesCompileOrThrow,
  InvalidRulesError,
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
    httpsRulesInput: getInput("allowed-https-rules"),
    httpRulesInput: getInput("allowed-http-rules"),
    ipRulesInput: getInput("allowed-ip-rules"),
  });
  const knownBlockedRules = parseKnownBlockedRulesOrThrow(getInput("known-blocked-rules"));
  const urlRulesInput = getInput("allowed-url-rules");
  const tlsRules = parseRulesOrThrow(getInput("allowed-tls-rules"));
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

/** Each rule input's list in RuleInputs. */
const RULE_LISTS = {
  "allowed-https-rules": "httpsRules",
  "allowed-http-rules": "httpRules",
  "allowed-ip-rules": "ipRules",
  "allowed-url-rules": "urlRules",
  "allowed-tls-rules": "tlsRules",
  "known-blocked-rules": "knownBlockedRules",
} as const satisfies Record<string, keyof RuleInputs>;

export type RuleInputName = keyof typeof RULE_LISTS;

// Linux takes at most 128 KiB in one environment variable, its name, "=" and
// the closing NUL included, and as much in one argument.
const ENV_VAR_LIMIT_BYTES = 128 * 1024;

/**
 * Checks that each named rule input, parsed and joined by newlines, fits in the
 * environment variable named after it, as the action hands it on. Past that,
 * starting the engine fails with E2BIG, which says nothing about the rules.
 *
 * @throws {InvalidRulesError} for the first input that does not fit
 */
export function checkRuleListSizesOrThrow(rules: RuleInputs, names: RuleInputName[]): void {
  for (const name of names) {
    const limit = ENV_VAR_LIMIT_BYTES - name.length - 2;
    const bytes = Buffer.byteLength(rules[RULE_LISTS[name]].join("\n"));
    if (bytes > limit)
      throw new InvalidRulesError(
        `${name} is ${bytes} bytes as parsed, over the ${limit} one environment variable can hold; write fewer, broader rules`,
        "INVALID_RULES",
      );
  }
}

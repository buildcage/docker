/**
 * Every `core.getInput` the setup and post steps make, in one place, so that
 * what this action reads is answerable from one file rather than by grepping
 * the entry points. The report action has its own (report/src/lib/inputs.ts).
 *
 * Read in two calls rather than one because the setup step needs the engine
 * before it resolves the image and the rules only after: folding them together
 * would move rule validation ahead of image verification, changing which error
 * a run with both problems reports.
 */
import * as core from "@actions/core";

import {
  buildACLRules,
  buildUrlRulesOrThrow,
  checkRulesCompileOrThrow,
  parseKnownBlockedRulesOrThrow,
  parseRulesOrThrow,
} from "#core/lib/acl/rules.ts";
import { DEFAULT_BUILDER_NAME } from "#core/lib/docker/report-source.ts";
import { resolveProxyEngine, type ProxyEngine } from "./engine.ts";
import { SetupError } from "./errors.ts";

/** Narrowed to what this module needs, so a test can pass a plain lookup. */
export type GetInput = (name: string) => string;

export function readBuilderName(getInput: GetInput = core.getInput): string {
  return getInput("builder_name") || DEFAULT_BUILDER_NAME;
}

export interface EngineInputs {
  proxyEngine: ProxyEngine;
}

export function readEngineInputs(getInput: GetInput = core.getInput): EngineInputs {
  return { proxyEngine: resolveProxyEngine(getInput("proxy_engine")) };
}

const PROXY_MODES = ["audit", "restrict"] as const;
export type ProxyMode = (typeof PROXY_MODES)[number];

/**
 * Anything but the two modes is refused rather than read as `restrict`, which
 * would enforce a run its author meant only to record.
 */
export function resolveProxyMode(input: string | undefined): ProxyMode {
  const trimmed = input?.trim() || "restrict";
  if (!(PROXY_MODES as readonly string[]).includes(trimmed)) {
    throw new SetupError(
      `Invalid proxy_mode: ${JSON.stringify(input)}. Must be one of ${PROXY_MODES.join(", ")}.`,
      "INVALID_PROXY_MODE",
    );
  }
  return trimmed as ProxyMode;
}

/** The spellings @actions/core's own getBooleanInput accepts. */
const TRUE_INPUTS = ["true", "True", "TRUE"];
const FALSE_INPUTS = ["false", "False", "FALSE"];

/**
 * Unset is true, the safe side: the dev and test invocations run this from
 * source rather than through action.yml's own default. Anything else that is
 * not a boolean is refused rather than guessed at, since reading a typo as
 * false would let a copy of the CA into the image without a word.
 */
export function resolveFailOnCaResidue(input: string | undefined): boolean {
  const trimmed = input?.trim() ?? "";
  if (trimmed === "" || TRUE_INPUTS.includes(trimmed)) {
    return true;
  }
  if (FALSE_INPUTS.includes(trimmed)) {
    return false;
  }
  throw new SetupError(
    `Invalid fail_on_ca_residue: ${JSON.stringify(input)}. Must be true or false.`,
    "INVALID_FAIL_ON_CA_RESIDUE",
  );
}

export interface ParsedRuleInputs {
  proxyMode: ProxyMode;
  /** Whether a copy of the inspect engine's CA left in a layer fails the build
   *  (see docker/inspect/buildcage-runc) rather than only warning. */
  failOnCaResidue: boolean;
  httpsRules: string[];
  httpRules: string[];
  ipRules: string[];
  /** The raw text of each compiled URL rule, not the compiled form: only the
   *  container re-compiles them, and only inspect enforces them. */
  urlRules: string[];
  tlsRules: string[];
  knownBlockedRules: string[];
}

/**
 * Parse and validate every rule input.
 *
 * URL and TLS rules are compiled here even on the engines that ignore them,
 * purely so a typo fails at setup rather than silently inside the container.
 * Everything is then compiled once more the way the container does it, so a
 * rule this parser accepts but the container refuses fails here too.
 *
 * The statement order decides which malformed-rule error surfaces first.
 *
 * @throws {SetupError} if proxy_mode is neither mode, or fail_on_ca_residue
 *   is not a boolean
 * @throws {InvalidRulesError} if any rule is malformed
 */
export function readRuleInputs(getInput: GetInput = core.getInput): ParsedRuleInputs {
  const proxyMode = resolveProxyMode(getInput("proxy_mode"));
  const failOnCaResidue = resolveFailOnCaResidue(getInput("fail_on_ca_residue"));
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
    proxyMode,
    failOnCaResidue,
    httpsRules: rules.httpsRules,
    httpRules: rules.httpRules,
    ipRules: rules.ipRules,
    urlRules,
    tlsRules,
    knownBlockedRules,
  };
}

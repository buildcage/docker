/**
 * Every `core.getInput` the setup and post steps make, in one place, so that
 * what this action reads is answerable from one file rather than by grepping
 * the entry points. The report action has its own (report/src/lib/inputs.ts).
 */
import * as core from "@actions/core";

import {
  readBooleanInput,
  resolveProxyMode,
  type ProxyEngine,
  type ProxyMode,
} from "#core/lib/actions/inputs.ts";
import { readRuleInputs, type RuleInputs } from "#core/lib/actions/rule-inputs.ts";
import { resolveBuilderName } from "#report/report-source.ts";

import { resolveProxyEngine } from "./engine.ts";

/** Narrowed to what this module needs, so a test can pass a plain lookup. */
export type GetInput = (name: string) => string;

export function readBuilderName(getInput: GetInput = core.getInput): string {
  return resolveBuilderName(getInput("builder-name"));
}

export interface SetupInputs extends RuleInputs {
  proxyEngine: ProxyEngine;
  builderName: string;
  proxyMode: ProxyMode;
  /** Whether CA residue in a layer fails the build rather than only warning. */
  failOnCaResidue: boolean;
}

/**
 * Parse and validate every input the setup step takes, in one call so that a
 * typo fails before anything touches the network.
 *
 * The statement order decides which error surfaces first.
 *
 * @throws {InvalidInputError} if proxy-engine, proxy-mode, fail-on-ca-residue
 *   or builder-name is malformed
 * @throws {InvalidRulesError} if any rule is malformed
 */
export function readSetupInputs(getInput: GetInput = core.getInput): SetupInputs {
  const proxyEngine = resolveProxyEngine(getInput("proxy-engine"));
  const proxyMode = resolveProxyMode(getInput("proxy-mode"));
  const failOnCaResidue = readBooleanInput("fail-on-ca-residue", true, getInput);
  return {
    proxyEngine,
    builderName: readBuilderName(getInput),
    proxyMode,
    failOnCaResidue,
    ...readRuleInputs(getInput),
  };
}

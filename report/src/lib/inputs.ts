/**
 * Every `core.getInput` the report action makes, in one place, so that what
 * this action reads is answerable from one file rather than by grepping the
 * entry point.
 *
 * Separate from src/lib/inputs.ts because this is a separate action with a
 * separate bundle: importing the setup action's would pull rule parsing into
 * report's dist for one string. The default they must agree on is shared as a
 * constant instead.
 */
import * as core from "@actions/core";

import { readBooleanInput } from "#core/lib/actions/inputs.ts";
import { resolveBuilderName } from "#report/report-source.ts";

/** Narrowed to what this module needs, so a test can pass a plain lookup. */
export type GetInput = (name: string) => string;

export function readBuilderName(getInput: GetInput = core.getInput): string {
  return resolveBuilderName(getInput("builder_name"));
}

/** The report script in the image reads fail_on_blocked itself; this only
 *  refuses a typo before anything runs. */
export function checkFailOnBlocked(getInput: GetInput = core.getInput): void {
  readBooleanInput("fail_on_blocked", true, getInput);
}

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

import { readBooleanInput, readRetentionDays } from "#core/lib/actions/inputs.ts";
import { DEFAULT_BUILDER_NAME } from "#report/report-source.ts";

/** Narrowed to what this module needs, so a test can pass a plain lookup. */
export type GetInput = (name: string) => string;

export function readBuilderName(getInput: GetInput = core.getInput): string {
  return getInput("builder_name") || DEFAULT_BUILDER_NAME;
}

/** The report script in the image reads fail_on_blocked itself; this only
 *  refuses a typo before anything runs. */
export function checkFailOnBlocked(getInput: GetInput = core.getInput): void {
  readBooleanInput("fail_on_blocked", true, getInput);
}

export interface TrafficArtifactInputs {
  wanted: boolean;
  /** Undefined leaves the retention to the repository's own default. */
  retentionDays?: number;
}

/** The retention is checked even when nothing is uploaded: a bad value is a
 *  mistake either way. */
export function readTrafficArtifactInputs(
  getInput: GetInput = core.getInput,
): TrafficArtifactInputs {
  return {
    wanted: readBooleanInput("upload_traffic_artifact", false, getInput),
    retentionDays: readRetentionDays(getInput),
  };
}

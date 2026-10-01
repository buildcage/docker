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

import { DEFAULT_BUILDER_NAME } from "#report/report-source.ts";

import { ReportError } from "./errors.ts";

/** Narrowed to what this module needs, so a test can pass a plain lookup. */
export type GetInput = (name: string) => string;

export function readBuilderName(getInput: GetInput = core.getInput): string {
  return getInput("builder_name") || DEFAULT_BUILDER_NAME;
}

/** Not `getBooleanInput`: it cannot tell unset from misspelled. Unset (a dev or
 *  test run without action.yml's defaults) takes the default. */
function readBooleanInput(name: string, fallback: boolean, getInput: GetInput): boolean {
  const value = getInput(name);
  if (value === "") return fallback;
  if (["true", "True", "TRUE"].includes(value)) return true;
  if (["false", "False", "FALSE"].includes(value)) return false;
  throw new ReportError(
    `Invalid ${name}: ${JSON.stringify(value)}. Must be true or false.`,
    "INVALID_BOOLEAN_INPUT",
  );
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
  const wanted = readBooleanInput("upload_traffic_artifact", false, getInput);
  const days = getInput("traffic_artifact_retention_days");
  if (days === "") return { wanted };
  if (!/^[1-9]\d*$/.test(days)) {
    throw new ReportError(
      `Invalid traffic_artifact_retention_days: ${JSON.stringify(days)}. ` +
        "Must be a whole number of days above zero.",
      "INVALID_TRAFFIC_ARTIFACT_RETENTION_DAYS",
    );
  }
  return { wanted, retentionDays: Number(days) };
}

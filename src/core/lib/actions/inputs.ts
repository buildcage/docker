import { ActionError } from "#core/lib/errors.ts";

/** A boolean or retention-days input whose value is malformed. */
export class InvalidInputError extends ActionError<
  "INVALID_BOOLEAN_INPUT" | "INVALID_TRAFFIC_ARTIFACT_RETENTION_DAYS"
> {}

/** `core.getInput`, narrowed so a test can pass a plain lookup. */
export type GetInput = (name: string) => string;

/** Not `getBooleanInput`: it cannot tell unset from misspelled. Unset (a dev or
 *  test run without action.yml's defaults) takes the fallback. */
export function readBooleanInput(name: string, fallback: boolean, getInput: GetInput): boolean {
  const value = getInput(name);
  if (value === "") return fallback;
  if (["true", "True", "TRUE"].includes(value)) return true;
  if (["false", "False", "FALSE"].includes(value)) return false;
  throw new InvalidInputError(
    `Invalid ${name}: ${JSON.stringify(value)}. Must be true or false.`,
    "INVALID_BOOLEAN_INPUT",
  );
}

/** Undefined when unset, which leaves the retention to the repository's own default. */
export function readRetentionDays(getInput: GetInput): number | undefined {
  const days = getInput("traffic_artifact_retention_days");
  if (days === "") return undefined;
  if (!/^[1-9]\d*$/.test(days)) {
    throw new InvalidInputError(
      `Invalid traffic_artifact_retention_days: ${JSON.stringify(days)}. ` +
        "Must be a whole number of days above zero.",
      "INVALID_TRAFFIC_ARTIFACT_RETENTION_DAYS",
    );
  }
  return Number(days);
}

/**
 * Single source of truth for the setup <-> report contract, so the two
 * can't silently drift apart. setup's Dockerfiles can't import this
 * directly (LABEL/COPY are static text), so keep those values in sync by hand.
 */
import type { ConfigFileInputs } from "#core/lib/actions/config-file.ts";
import { inputEnvName } from "#core/lib/actions/input-names.ts";
import { InvalidInputError } from "#core/lib/actions/inputs.ts";

export const REPORT_SOURCE_LABEL = "io.github.buildcage.report-source";
export const REPORT_ACTION_SCRIPT_PATH = "/opt/buildcage/scripts/report-action.js";

/**
 * `builder-name` when unset; action.yml declares no default of its own, so
 * config-file can tell unset from set. Part of the contract because setup,
 * report and post each read the input separately and have to derive the same
 * project name: a value that differed between them would leave report looking
 * for a container setup never named.
 */
export const DEFAULT_BUILDER_NAME = "buildcage";

/** Docker's own rule for a container name. */
const BUILDER_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/;

/**
 * `builder-name`, or the default when unset. Checked before setup sets it as
 * an output: config-file may have supplied it, and a workflow can paste the
 * output into a `run:` script.
 *
 * @throws {InvalidInputError} if the name is not a valid container name
 */
export function resolveBuilderName(value: string): string {
  if (value === "") return DEFAULT_BUILDER_NAME;
  if (!BUILDER_NAME_PATTERN.test(value)) {
    throw new InvalidInputError<"INVALID_BUILDER_NAME">(
      `Invalid builder-name: ${JSON.stringify(value)}. ` +
        "Must start with a letter or digit and have at least two characters, " +
        "using only letters, digits, '_', '.' and '-'.",
      "INVALID_BUILDER_NAME",
    );
  }
  return value;
}

const LIST_INPUTS = [
  "allowed-https-rules",
  "allowed-http-rules",
  "allowed-ip-rules",
  "allowed-url-rules",
  "allowed-tls-rules",
  "known-blocked-rules",
];

/**
 * The inputs of setup and report both, since one config-file is handed to
 * each: a key only the other action reads is still not a typo. Part of the
 * contract for the same reason as builder-name.
 */
export const CONFIG_FILE_INPUTS: ConfigFileInputs = {
  known: [
    "builder-name",
    "proxy-mode",
    "proxy-engine",
    ...LIST_INPUTS,
    "fail-on-ca-residue",
    "fail-on-blocked",
    "upload-traffic-artifact",
    "traffic-artifact-retention-days",
  ],
  lists: LIST_INPUTS,
};

/** Every input of setup and report, for normalizeInputNames. */
export const INPUT_NAMES = ["config-file", ...CONFIG_FILE_INPUTS.known];

/**
 * Removes the list inputs from env, for a step that has read them. config-file
 * appends to them, and a variable over 128 KiB makes every exec that inherits
 * it fail with E2BIG.
 */
export function dropListInputs(env: NodeJS.ProcessEnv): void {
  for (const name of LIST_INPUTS) delete env[inputEnvName(name)];
}

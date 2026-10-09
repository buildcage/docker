import * as core from "@actions/core";

import { ActionError } from "#core/lib/errors.ts";

type InvalidInputCode =
  | "INVALID_BOOLEAN_INPUT"
  | "INVALID_TRAFFIC_ARTIFACT_RETENTION_DAYS"
  | "INVALID_PROXY_MODE"
  | "INVALID_PROXY_ENGINE";

/**
 * An input whose value is malformed, or names something the step cannot do.
 * `Extra` adds codes for an input only one action has.
 */
export class InvalidInputError<Extra extends string = never> extends ActionError<
  InvalidInputCode | Extra
> {
  // NoInfer, or a misspelled code would be inferred as an Extra.
  constructor(message: string, code: InvalidInputCode | NoInfer<Extra>) {
    super(message, code);
  }
}

/** `core.getInput`, narrowed so a test can pass a plain lookup. */
export type GetInput = (name: string) => string;

/** Not `getBooleanInput`: it cannot tell unset from misspelled. Unset takes the
 *  fallback: action.yml declares no default, so config_file can tell unset from set. */
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

export interface TrafficArtifactInputs {
  upload: boolean;
  /** Undefined leaves the retention to the repository's own default. */
  retentionDays?: number;
}

/** The retention is checked even when nothing is uploaded: a bad value is a
 *  mistake either way. */
export function readTrafficArtifactInputs(
  getInput: GetInput = core.getInput,
): TrafficArtifactInputs {
  return {
    upload: readBooleanInput("upload_traffic_artifact", false, getInput),
    retentionDays: readRetentionDays(getInput),
  };
}

/**
 * Each accepted value maps to a separately published, separately tagged
 * Docker image (see provenance/image-tag.ts's imageTagFromRef).
 */
const ENGINES = ["universal", "inspect"] as const;
export type ProxyEngine = (typeof ENGINES)[number];

export function resolveProxyEngine(input: string | undefined): ProxyEngine {
  const trimmed = input?.trim() || "inspect";
  if (trimmed === "transparent") {
    throw new InvalidInputError(
      "proxy_engine: transparent has been renamed. Use proxy_engine: universal.",
      "INVALID_PROXY_ENGINE",
    );
  }
  if (!(ENGINES as readonly string[]).includes(trimmed)) {
    throw new InvalidInputError(
      `Invalid proxy_engine: ${JSON.stringify(input)}. Must be one of ${ENGINES.join(", ")}.`,
      "INVALID_PROXY_ENGINE",
    );
  }
  return trimmed as ProxyEngine;
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
    throw new InvalidInputError(
      `Invalid proxy_mode: ${JSON.stringify(input)}. Must be one of ${PROXY_MODES.join(", ")}.`,
      "INVALID_PROXY_MODE",
    );
  }
  return trimmed as ProxyMode;
}

/**
 * Single source of truth for the setup <-> report contract, so the two
 * can't silently drift apart. setup's Dockerfiles can't import this
 * directly (LABEL/COPY are static text), so keep those values in sync by hand.
 */
import type { ConfigFileInputs } from "#core/lib/actions/config-file.ts";

export const REPORT_SOURCE_LABEL = "io.github.buildcage.report-source";
export const REPORT_ACTION_SCRIPT_PATH = "/opt/buildcage/scripts/report-action.js";

/**
 * `builder_name` when unset; action.yml declares no default of its own, so
 * config_file can tell unset from set. Part of the contract because setup,
 * report and post each read the input separately and have to derive the same
 * project name: a value that differed between them would leave report looking
 * for a container setup never named.
 */
export const DEFAULT_BUILDER_NAME = "buildcage";

const LIST_INPUTS = [
  "allowed_https_rules",
  "allowed_http_rules",
  "allowed_ip_rules",
  "allowed_url_rules",
  "allowed_tls_rules",
  "known_blocked_rules",
];

/**
 * The inputs of setup and report both, since one config_file is handed to
 * each: a key only the other action reads is still not a typo. Part of the
 * contract for the same reason as builder_name.
 */
export const CONFIG_FILE_INPUTS: ConfigFileInputs = {
  known: [
    "builder_name",
    "proxy_mode",
    "proxy_engine",
    ...LIST_INPUTS,
    "fail_on_ca_residue",
    "fail_on_blocked",
    "upload_traffic_artifact",
    "traffic_artifact_retention_days",
  ],
  lists: LIST_INPUTS,
};

/**
 * Single source of truth for the setup <-> report contract, so the two
 * can't silently drift apart. setup's Dockerfiles can't import this
 * directly (LABEL/COPY are static text), so keep those values in sync by hand.
 */
export const REPORT_SOURCE_LABEL = "io.github.buildcage.report-source";
export const REPORT_ACTION_SCRIPT_PATH = "/opt/buildcage/scripts/report-action.js";

/**
 * Fallback for `builder_name` outside the Actions runtime, where
 * `core.getInput` sees nothing; action.yml's own `default: 'buildcage'`
 * covers the normal case. Part of the contract because setup, report and post
 * each read the input separately and have to derive the same project name:
 * a value that differed between them would leave report looking for a
 * container setup never named.
 */
export const DEFAULT_BUILDER_NAME = "buildcage";

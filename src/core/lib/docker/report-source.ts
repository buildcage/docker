/**
 * Single source of truth for the setup <-> report contract, so the two
 * can't silently drift apart. setup's Dockerfiles can't import this
 * directly (LABEL/COPY are static text) — keep those values in sync by hand.
 */
export const REPORT_SOURCE_LABEL = "io.github.buildcage.report-source";
export const REPORT_ACTION_SCRIPT_PATH = "/opt/buildcage/scripts/report-action.js";

/**
 * Contract between setup's Docker images and the report action: the label
 * setup applies to the builder container so report can find it, and the
 * path inside that container where setup bakes in report-action.js for
 * report to `docker cp` out and run.
 *
 * setup's Dockerfiles (setup/docker/{transparent,explicit}/Dockerfile)
 * can't import this directly — Dockerfile LABEL/COPY instructions are
 * static text — so their values must be kept in sync with these constants
 * by hand. report/src imports them directly.
 */
export const REPORT_SOURCE_LABEL = "io.github.buildcage.report-source";
export const REPORT_ACTION_SCRIPT_PATH = "/opt/buildcage/scripts/report-action.js";

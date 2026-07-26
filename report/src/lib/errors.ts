import { ActionError } from "../../../core/lib/general/action-error.ts";

/**
 * ReportError — intentional error in the report action's own logic. Invalid
 * ACL rule syntax throws InvalidRulesError instead (see
 * core/lib/acl/rules.ts).
 *
 * Codes:
 *   DOCKER_UNAVAILABLE   – docker CLI missing from PATH, or `docker ps`/`docker cp` failed
 *   CONTAINER_NOT_FOUND  – `docker ps --filter` didn't find exactly one
 *                          report-source container for this builder_name
 *   REPORT_SCRIPT_FAILED – report-action.js couldn't even be launched (e.g.
 *                          node itself failed to start it) — a
 *                          report-action.js that ran and exited nonzero on
 *                          its own is reproduced via this action's own
 *                          exit code instead, not this error
 */
export class ReportError extends ActionError<"DOCKER_UNAVAILABLE" | "CONTAINER_NOT_FOUND" | "REPORT_SCRIPT_FAILED"> {}

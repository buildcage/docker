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
 *   REPORT_SCRIPT_FAILED – report.sh itself (or making it executable) failed
 *                          after being fetched from the container — not
 *                          necessarily a Docker/runner problem, so this is
 *                          kept distinct from DOCKER_UNAVAILABLE
 */
export class ReportError extends ActionError<"DOCKER_UNAVAILABLE" | "CONTAINER_NOT_FOUND" | "REPORT_SCRIPT_FAILED"> {}

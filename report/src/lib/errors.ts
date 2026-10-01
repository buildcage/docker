import { ActionError } from "#core/lib/errors.ts";

/**
 * Intentional error in the report action's own logic. Invalid ACL rule syntax
 * throws InvalidRulesError instead (see core/lib/acl/rules.ts).
 *
 * Codes:
 *   DOCKER_UNAVAILABLE:   docker CLI missing from PATH, or a docker call
 *                         (`ps`, `inspect`, `create`, `cp`) failed
 *   CONTAINER_NOT_FOUND:  `docker ps --filter` didn't find exactly one
 *                         report-source container for this builder_name
 *   REPORT_SCRIPT_FAILED: report-action.js couldn't even be launched (a
 *                         report-action.js that ran and exited nonzero is
 *                         reproduced via this action's exit code instead)
 *   INVALID_BOOLEAN_INPUT: fail_on_blocked or upload_traffic_artifact is
 *                         neither true nor false
 *   INVALID_TRAFFIC_ARTIFACT_RETENTION_DAYS: traffic_artifact_retention_days
 *                         is not a whole number above zero
 */
export class ReportError extends ActionError<
  | "DOCKER_UNAVAILABLE"
  | "CONTAINER_NOT_FOUND"
  | "REPORT_SCRIPT_FAILED"
  | "INVALID_BOOLEAN_INPUT"
  | "INVALID_TRAFFIC_ARTIFACT_RETENTION_DAYS"
> {}

import { ActionError } from "../../../core/lib/general/action-error.ts";

/**
 * ReportError — intentional error in the report action's own logic. Invalid
 * ACL rule syntax throws InvalidRulesError instead (see
 * core/lib/acl/rules.js).
 *
 * Codes:
 *   DOCKER_UNAVAILABLE – docker CLI missing from PATH or a docker command failed
 */
export class ReportError extends ActionError<"DOCKER_UNAVAILABLE"> {}

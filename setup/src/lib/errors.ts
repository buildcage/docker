import { ActionError } from "../../../core/lib/general/action-error.ts";

/**
 * SetupError — intentional error in the setup action's own logic. Image
 * provenance failures throw ProvenanceError instead (see
 * core/lib/provenance/errors.js); invalid ACL rule syntax throws
 * InvalidRulesError instead (see core/lib/acl/rules.js).
 *
 * Codes:
 *   DOCKER_UNAVAILABLE    – docker CLI missing from PATH or a docker command failed
 *   INVALID_PROXY_ENGINE  – proxy_engine input isn't "transparent" or "explicit"
 */
export type SetupErrorCode = "DOCKER_UNAVAILABLE" | "INVALID_PROXY_ENGINE";

export class SetupError extends ActionError<SetupErrorCode> {}

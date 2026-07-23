import { ActionError } from "../../../core/lib/general/action-error.ts";

/**
 * SetupError — intentional error in the setup action's own logic. Image
 * provenance failures throw ProvenanceError instead (see
 * core/lib/provenance/errors.js).
 *
 * Codes:
 *   INVALID_RULES        – ACL rule syntax error
 *   DOCKER_UNAVAILABLE    – docker CLI missing from PATH or a docker command failed
 *   INVALID_PROXY_ENGINE  – proxy_engine input isn't "transparent" or "explicit"
 */
export class SetupError extends ActionError {}

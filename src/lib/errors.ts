import { ActionError } from "#core/lib/errors.ts";

/**
 * The codes of SetupError, the intentional error in the setup action's own
 * logic. Image provenance failures throw ProvenanceError instead (see
 * core/lib/provenance/errors.ts); invalid ACL rule syntax throws
 * InvalidRulesError instead (see core/lib/acl/rules.ts); any other malformed
 * input throws InvalidInputError (see core/lib/actions/inputs.ts).
 *
 * Codes:
 *   DOCKER_UNAVAILABLE: docker CLI missing from PATH or a docker command failed
 *   BUILDER_NOT_READY:  the builder container started but never became usable
 */
export type SetupErrorCode = "DOCKER_UNAVAILABLE" | "BUILDER_NOT_READY";

export class SetupError extends ActionError<SetupErrorCode> {}

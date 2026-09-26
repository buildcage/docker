import { ActionError } from "#core/lib/errors.ts";

/**
 * The codes of SetupError, the intentional error in the setup action's own
 * logic. Image provenance failures throw ProvenanceError instead (see
 * core/lib/provenance/errors.ts); invalid ACL rule syntax throws
 * InvalidRulesError instead (see core/lib/acl/rules.ts).
 *
 * Codes:
 *   DOCKER_UNAVAILABLE:   docker CLI missing from PATH or a docker command failed
 *   BUILDER_NOT_READY:    the builder container started but never became usable
 *   INVALID_PROXY_ENGINE: proxy_engine input isn't "universal" or "inspect"
 *   INVALID_PROXY_MODE:   proxy_mode input isn't "audit" or "restrict"
 *   INVALID_FAIL_ON_CA_RESIDUE: fail_on_ca_residue input isn't a boolean
 */
export type SetupErrorCode =
  | "DOCKER_UNAVAILABLE"
  | "BUILDER_NOT_READY"
  | "INVALID_PROXY_ENGINE"
  | "INVALID_PROXY_MODE"
  | "INVALID_FAIL_ON_CA_RESIDUE";

export class SetupError extends ActionError<SetupErrorCode> {}

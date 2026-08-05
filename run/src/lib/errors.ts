import { ActionError } from "#core/lib/errors.ts";

/**
 * SandboxError — intentional error in the run action's own logic. Image
 * provenance failures throw ProvenanceError instead (see
 * core/lib/provenance/errors.ts); invalid ACL rule syntax throws
 * InvalidRulesError instead (see core/lib/acl/rules.ts).
 *
 * Codes:
 *   MISSING_RUN                – required `run` input was empty
 *   PROXY_NOT_RUNNING          – sandbox proxy container isn't running after `docker compose up`
 *   RUNC_EXTRACT_FAILED        – failed to `docker cp` runc/gen-seccomp-profile out of the proxy image
 *   OCI_CONFIG_BUILD_FAILED    – failed to run gen-seccomp-profile/runc spec or assemble config.json
 *   DOCKER_UNAVAILABLE         – docker CLI missing from PATH or a docker command failed
 *   PASSWORDLESS_SUDO_REQUIRED – sudo -n check failed; passwordless sudo isn't configured
 */
export type SandboxErrorCode =
  | "MISSING_RUN"
  | "PROXY_NOT_RUNNING"
  | "RUNC_EXTRACT_FAILED"
  | "OCI_CONFIG_BUILD_FAILED"
  | "DOCKER_UNAVAILABLE"
  | "PASSWORDLESS_SUDO_REQUIRED";

export class SandboxError extends ActionError<SandboxErrorCode> {}

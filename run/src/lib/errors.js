/**
 * SandboxError — intentional error in the run action.
 *
 * All expected failure paths (missing image, network error, verification
 * failure, invalid config) throw SandboxError. Anything that is NOT a
 * SandboxError is treated as an unexpected error by the main entry point.
 *
 * Codes:
 *   NOT_FOUND        – resource does not exist (missing tag or bundle)
 *   TRANSIENT        – network or 5xx error; do not treat as "resource absent"
 *   TOKEN_ERROR      – registry token endpoint returned a client error
 *   VERIFY_FAILED    – Sigstore bundle verification failed
 *   UNVERIFIABLE_REF – action ref cannot be verified (branch / local path)
 *   INVALID_RULES    – ACL rule syntax error
 *   MISSING_RUN      – required `run` input was empty
 *   PROXY_NOT_RUNNING – sandbox proxy container isn't running after `docker compose up`
 *   RUNC_EXTRACT_FAILED – failed to `docker cp` runc/gen-seccomp-profile out of the proxy image
 *   OCI_CONFIG_BUILD_FAILED – failed to run gen-seccomp-profile/runc spec or assemble config.json
 */
export class SandboxError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "SandboxError";
    this.code = code;
  }
}

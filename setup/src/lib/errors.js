/**
 * SetupError — intentional error in the setup action.
 *
 * All expected failure paths (missing image, network error, verification
 * failure, invalid config) throw SetupError.  Anything that is NOT a
 * SetupError is treated as an unexpected error by the main entry point.
 *
 * Codes:
 *   NOT_FOUND        – resource does not exist (missing tag or bundle)
 *   TRANSIENT        – network or 5xx error; do not treat as "resource absent"
 *   TOKEN_ERROR      – registry token endpoint returned a client error
 *   VERIFY_FAILED    – Sigstore bundle verification failed
 *   UNVERIFIABLE_REF – action ref cannot be verified (branch / local path)
 *   INVALID_RULES    – ACL rule syntax error
 *   DOCKER_UNAVAILABLE – docker CLI missing from PATH or a docker command failed
 */
export class SetupError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "SetupError";
    this.code = code;
  }
}

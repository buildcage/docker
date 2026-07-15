/**
 * SandboxError — intentional error in the sandbox action.
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
 *   ISOLATION_FAILED – run-isolated.sh itself failed (before the user command ran)
 */
export class SandboxError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "SandboxError";
    this.code = code;
  }
}

/**
 * VerifyImageError — intentional error in the image provenance verification
 * flow (Sigstore bundle fetch/verify, OCI registry lookups, image ref
 * resolution).
 *
 * Codes:
 *   NOT_FOUND        – resource does not exist (missing tag or bundle)
 *   TRANSIENT        – network or 5xx error; do not treat as "resource absent"
 *   TOKEN_ERROR      – registry token endpoint returned a client error
 *   VERIFY_FAILED    – Sigstore bundle verification failed
 */
export class VerifyImageError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "VerifyImageError";
    this.code = code;
  }
}

import { ActionError } from "../errors.ts";

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
export type VerifyImageErrorCode = "NOT_FOUND" | "TRANSIENT" | "TOKEN_ERROR" | "VERIFY_FAILED";

export class VerifyImageError extends Error {
  code: VerifyImageErrorCode;

  constructor(message: string, code: VerifyImageErrorCode) {
    super(message);
    this.name = "VerifyImageError";
    this.code = code;
  }
}

/**
 * ProvenanceError — thrown by verifyImageDigestOrThrow (see verify-image.ts)
 * when image provenance can't be established. Extends ActionError so a
 * caller's own top-level catch (checking `instanceof ActionError`)
 * recognizes it as a safe-to-print error.
 *
 * Codes:
 *   NOT_FOUND        – resource does not exist (missing tag or bundle)
 *   TRANSIENT        – network or 5xx error; do not treat as "resource absent"
 *   TOKEN_ERROR      – registry token endpoint returned a client error
 *   VERIFY_FAILED    – Sigstore bundle verification failed
 *   UNVERIFIABLE_REF – action ref cannot be verified (branch / local path)
 */
export type ProvenanceErrorCode = VerifyImageErrorCode | "UNVERIFIABLE_REF";

export class ProvenanceError extends ActionError<ProvenanceErrorCode> {}

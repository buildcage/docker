import { ActionError } from "../general/action-error.js";

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

/**
 * ProvenanceError — thrown by verifyImageDigestOrThrow (see verify-image.js)
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
export class ProvenanceError extends ActionError {}

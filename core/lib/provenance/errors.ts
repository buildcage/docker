import { ActionError } from "../general/action-error.ts";

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
export const VERIFY_IMAGE_ERROR_CODES = ["NOT_FOUND", "TRANSIENT", "TOKEN_ERROR", "VERIFY_FAILED"] as const;
export type VerifyImageErrorCode = (typeof VERIFY_IMAGE_ERROR_CODES)[number];

export class VerifyImageError extends Error {
  code: VerifyImageErrorCode;

  constructor(message: string, code: VerifyImageErrorCode) {
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
export const PROVENANCE_ERROR_CODES = [...VERIFY_IMAGE_ERROR_CODES, "UNVERIFIABLE_REF"] as const;
export type ProvenanceErrorCode = (typeof PROVENANCE_ERROR_CODES)[number];

export function isProvenanceErrorCode(code: unknown): code is ProvenanceErrorCode {
  return typeof code === "string" && (PROVENANCE_ERROR_CODES as readonly string[]).includes(code);
}

export class ProvenanceError extends ActionError<ProvenanceErrorCode> {}

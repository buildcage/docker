/**
 * verify-image.ts — Image provenance verification helpers
 *
 * Verifies the Docker image's Sigstore provenance bundle.
 *
 * Fail-closed policy:
 *   - Any failure for a verifiable ref (version tag / 40-char SHA) → throws
 *     VerifyImageError; the caller (main) is responsible for printing ::error::.
 *   - Unverifiable ref (branch / local ./setup) → returns null.
 */

import {
  fetchManifestDigest,
  fetchRegistryToken,
  fetchBundle,
  readGhcrBasicAuth,
} from "./oci-registry.ts";
import { verifyBundle } from "./sigstore.ts";
import type { DsseBundle } from "./signed-digest.ts";
import { imageTagFromRef } from "./image-tag.ts";
import { buildVerifyOptions, type VerifyImageIdentity } from "./verify-policy.ts";
import { ProvenanceError, VerifyImageError } from "./errors.ts";
import { errorMessage } from "../errors.ts";

const REGISTRY = "ghcr.io";

export interface VerifyImageDigestOptions extends VerifyImageIdentity {
  proxyEngine?: string;
}

/** The verified, digest-pinned image ref an action is about to pull. */
export interface ResolvedImage {
  imageRef: string;
  pullPolicy: "always";
}

/**
 * Verify image provenance and return the verified manifest digest.
 *
 * Returns null for unverifiable refs (branch / local ./setup).
 * On failure, throws VerifyImageError — the caller is responsible for printing
 * the error message.
 *
 */
export async function verifyImageDigest({
  actionRef,
  actionRepo,
  proxyEngine = "transparent",
}: VerifyImageDigestOptions): Promise<string | null> {
  const repoPath = actionRepo.toLowerCase();

  const verifyOptions = buildVerifyOptions({ actionRef, actionRepo });
  if (!verifyOptions) return null;

  const tag = imageTagFromRef(actionRef, proxyEngine);
  const regToken = await fetchRegistryToken(REGISTRY, repoPath, readGhcrBasicAuth());
  const digest = await fetchManifestDigest(REGISTRY, repoPath, tag, regToken);
  const bundle = await fetchBundle(REGISTRY, repoPath, digest, regToken);
  await verifyBundle(bundle as DsseBundle, verifyOptions, digest);
  return digest;
}

/** Maps a VerifyImageError (or any other thrown value) to the caller-facing ProvenanceError. */
export function toProvenanceError(e: unknown): ProvenanceError {
  if (e instanceof VerifyImageError) {
    return new ProvenanceError(e.message, e.code);
  }
  return new ProvenanceError(errorMessage(e), "VERIFY_FAILED");
}

/**
 * verifyImageDigest returns null for an unverifiable ref (branch name,
 * local ./setup) rather than throwing — this turns that into the
 * caller-facing error.
 */
export function requireDigest(digest: string | null, actionRef: string): string {
  if (digest === null) {
    throw new ProvenanceError(
      `Cannot verify image provenance for ref: ${JSON.stringify(actionRef)}. ` +
        `Pin the action to a version tag (e.g. @v2.1.0) or a commit SHA.`,
      "UNVERIFIABLE_REF",
    );
  }
  return digest;
}

/**
 * Like verifyImageDigest, but throws ProvenanceError (see errors.ts) instead
 * of the low-level VerifyImageError, so a caller gets one already-typed
 * error to catch rather than having to translate the result itself.
 */
export async function verifyImageDigestOrThrow({
  actionRef,
  actionRepo,
  proxyEngine,
}: VerifyImageDigestOptions): Promise<string> {
  let digest;
  try {
    digest = await verifyImageDigest({ actionRef, actionRepo, proxyEngine });
  } catch (e) {
    throw toProvenanceError(e);
  }
  return requireDigest(digest, actionRef);
}

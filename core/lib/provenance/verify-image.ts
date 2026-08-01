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
import { derUtf8, verifyBundle, type VerifyBundleOptions, type DsseBundle } from "./sigstore.ts";
import { ProvenanceError, VerifyImageError } from "./errors.ts";
import { errorMessage } from "../general/error-message.ts";

const REGISTRY = "ghcr.io";
const EXPECTED_ISSUER = "https://token.actions.githubusercontent.com";
const RELEASE_WORKFLOW = ".github/workflows/docker-publish.yml";

// Fulcio OID: Source Repository Digest — the commit SHA of the build source.
// Value encoding: DER UTF8String ([0x0C, len, ...utf8bytes]) inside OCTET STRING.
const OID_SOURCE_REPO_DIGEST = "1.3.6.1.4.1.57264.1.13";

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface VerifyImageIdentity {
  actionRef: string;
  actionRepo: string;
}

export interface VerifyImageDigestOptions extends VerifyImageIdentity {
  proxyEngine?: string;
}

export interface VerifyImageDigestOrThrowOptions extends VerifyImageDigestOptions {
  verifyImageDigestFn?: typeof verifyImageDigest;
}

/** The verified, digest-pinned image ref an action is about to pull. */
export interface ResolvedImage {
  imageRef: string;
  pullPolicy: "always";
}

/**
 * Convert an action ref into the base Docker image tag, then append the
 * proxy engine suffix for non-default engines. The `transparent` engine
 * (default) publishes the plain version tag (e.g. `2.1.0`), matching the
 * pre-multi-engine tagging scheme; `explicit` (experimental) and `proxy`
 * (the buildkitd-less network-isolation proxy used by the run action)
 * each publish under their own suffix (e.g. `2.1.0-explicit`,
 * `2.1.0-proxy`). All three share the same Sigstore verification identity
 * (same workflow, same git ref) — only the published Docker tag differs, so
 * this does not affect buildVerifyOptions below.
 */
export function imageTagFromRef(
  actionRef: string | undefined,
  proxyEngine: string = "transparent",
): string {
  if (!actionRef) return "";
  let base;
  if (/^[0-9a-f]{40}$/i.test(actionRef)) {
    base = `sha-${actionRef.toLowerCase()}`;
  } else if (actionRef.startsWith("v")) {
    base = actionRef.slice(1);
  } else {
    base = actionRef;
  }
  if (proxyEngine === "explicit" || proxyEngine === "proxy") return `${base}-${proxyEngine}`;
  return base;
}

/**
 * Build verify options encoding the expected certificate identity.
 *
 * The SAN URI pattern uses `(\.|$)` boundary anchors for version tags so that
 * e.g. @v2.1 matches v2.1.0 and v2.1.3 but NOT v2.10.0.
 *
 * For SHA pins, OID 1.13 (Source Repository Digest) pins the exact commit
 * while the SAN accepts any release tag.
 *
 * Returns null for unverifiable refs (branch names, local paths).
 */
export function buildVerifyOptions({
  actionRef,
  actionRepo,
}: VerifyImageIdentity): VerifyBundleOptions | null {
  const sanPrefix = `^${escapeRegex(`https://github.com/${actionRepo}/${RELEASE_WORKFLOW}@refs/tags/`)}`;
  const base = {
    certificateIssuer: EXPECTED_ISSUER,
    tlogThreshold: 1,
    ctLogThreshold: 1,
  };

  // SHA pin: the SAN accepts any v*-prefixed release tag — the exact commit is
  // pinned by OID 1.13 (Source Repository Digest), which enforces a strict byte
  // match against the pinned SHA and cannot be satisfied by any other commit.
  if (/^[0-9a-f]{40}$/i.test(actionRef)) {
    return {
      ...base,
      certificateIdentityURI: `${sanPrefix}v`,
      certificateOIDs: {
        [OID_SOURCE_REPO_DIGEST]: derUtf8(actionRef.toLowerCase()),
      },
    };
  }

  // Version tag: SAN ref must match this version (boundary-safe via (\.|$)).
  if (actionRef.startsWith("v")) {
    return {
      ...base,
      certificateIdentityURI: `${sanPrefix}${escapeRegex(actionRef)}(\\.|$)`,
    };
  }

  return null; // branch name, local ./setup, etc. — no verifiable release bundle
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

/**
 * Like verifyImageDigest, but throws ProvenanceError (see errors.ts) instead
 * of the low-level VerifyImageError, so a caller gets one already-typed
 * error to catch rather than having to translate the result itself.
 *
 * `verifyImageDigestFn` is an injectable seam (defaults to the real
 * verifyImageDigest) for unit-testing without hitting the network/sigstore.
 */
export async function verifyImageDigestOrThrow({
  actionRef,
  actionRepo,
  proxyEngine,
  verifyImageDigestFn = verifyImageDigest,
}: VerifyImageDigestOrThrowOptions): Promise<string> {
  let digest;
  try {
    digest = await verifyImageDigestFn({ actionRef, actionRepo, proxyEngine });
  } catch (e) {
    if (e instanceof VerifyImageError) {
      throw new ProvenanceError(e.message, e.code);
    }
    throw new ProvenanceError(errorMessage(e), "VERIFY_FAILED");
  }
  if (digest === null) {
    throw new ProvenanceError(
      `Cannot verify image provenance for ref: ${JSON.stringify(actionRef)}. ` +
        `Pin the action to a version tag (e.g. @v2.1.0) or a commit SHA.`,
      "UNVERIFIABLE_REF",
    );
  }
  return digest;
}

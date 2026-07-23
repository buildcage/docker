// @ts-nocheck
import { bundleFromJSON } from "@sigstore/bundle";
import { getTrustedRoot } from "@sigstore/tuf";
import { toSignedEntity, toTrustMaterial, Verifier } from "@sigstore/verify";
import { VerifyImageError } from "./errors.js";

// Encode a string as DER UTF8String for Fulcio OID extension values.
// sigstore-js compares the raw OCTET STRING bytes, so we must include
// the DER tag (0x0C) and length prefix. Assumes len < 128.
export const derUtf8 = (s) => String.fromCharCode(0x0c, s.length) + s;

/**
 * Extract and assert the signed manifest digest from a cosign DSSE bundle.
 *
 * Two payload formats are supported depending on the cosign version:
 *
 * 1. in-toto Statement v1 (payloadType "application/vnd.in-toto+json")
 *    Used by cosign --new-bundle-format (v2.4+).
 *    Digest is stored in subject[].digest.sha256.
 *
 * 2. simple-signing (legacy cosign)
 *    Digest is stored in critical.image.docker-manifest-digest.
 *
 * This check closes the gap between Referrers-API attribution (registry
 * metadata, not cryptographic) and the actual signed content — an attacker
 * with package-write access could re-attach a valid bundle to a different
 * image; this assertion prevents accepting such a re-attached bundle.
 *
 * Exported for unit testing; callers should use verifyBundle() instead.
 *
 * @param {object} bundleJson   — raw bundle JSON object
 * @param {string} expectedDigest — "sha256:<hex>" from getManifestDigest()
 */
export function assertSignedDigest(bundleJson, expectedDigest) {
  const dsse = bundleJson?.dsseEnvelope;
  const payload = dsse?.payload;
  if (!payload) {
    throw new VerifyImageError(
      "Bundle is not a DSSE envelope or is missing a signed payload",
      "VERIFY_FAILED",
    );
  }

  try {
    const sl = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));

    if (dsse.payloadType === "application/vnd.in-toto+json") {
      // in-toto Statement v1: subject[].digest.sha256 holds the manifest digest.
      const subjects = sl?.subject ?? [];
      const matched = subjects.some(
        (s) => s?.digest?.sha256 && `sha256:${s.digest.sha256}` === expectedDigest,
      );
      if (!matched) {
        const found =
          subjects
            .map((s) => (s?.digest?.sha256 ? `sha256:${s.digest.sha256}` : null))
            .filter(Boolean)
            .join(", ") || "missing";
        throw new VerifyImageError(
          `Signed digest (${found}) does not match ` +
            `fetched digest (${expectedDigest}). ` +
            `The bundle may have been re-attached to a different image.`,
          "VERIFY_FAILED",
        );
      }
    } else {
      // simple-signing format: critical.image.docker-manifest-digest.
      const signedDigest = sl?.critical?.image?.["docker-manifest-digest"];
      if (!signedDigest || signedDigest !== expectedDigest) {
        throw new VerifyImageError(
          `Signed digest (${signedDigest ?? "missing"}) does not match ` +
            `fetched digest (${expectedDigest}). ` +
            `The bundle may have been re-attached to a different image.`,
          "VERIFY_FAILED",
        );
      }
    }
  } catch (err) {
    if (err instanceof VerifyImageError) throw err;
    throw new VerifyImageError(
      "Failed to parse signed payload from bundle",
      "VERIFY_FAILED",
    );
  }
}

/**
 * Cryptographically verify a Sigstore Bundle (DSSE format) against a policy,
 * then assert that the bundle's signed manifest digest matches the fetched digest.
 *
 * The bundle's DSSE envelope contains its own signed payload; no external
 * payload is needed for this format.
 *
 * Policy fields in options:
 *   certificateIssuer      – expected Fulcio OIDC issuer URL
 *   certificateIdentityURI – SAN URI regexp pattern string
 *   certificateOIDs        – { [oid]: derUtf8EncodedValue } map
 *   tlogThreshold          – minimum transparency log entries (default 1)
 *   ctLogThreshold         – minimum CT log entries (default 1)
 *
 * @param {object} bundleJson     — raw bundle JSON object
 * @param {object} options        — policy options
 * @param {string} expectedDigest — "sha256:<hex>" fetched from the registry;
 *                                  must match the digest inside the signed payload
 */
export async function verifyBundle(bundleJson, options, expectedDigest) {
  const trustedRoot = await getTrustedRoot();
  const verifier = new Verifier(toTrustMaterial(trustedRoot), {
    ctlogThreshold: options.ctLogThreshold,
    tlogThreshold: options.tlogThreshold,
  });

  const policy = {};
  if (options.certificateIdentityURI) {
    policy.subjectAlternativeName = options.certificateIdentityURI;
  }
  if (options.certificateIssuer) {
    policy.extensions = { issuer: options.certificateIssuer };
  }
  if (options.certificateOIDs) {
    policy.oids = Object.entries(options.certificateOIDs).map(
      ([oid, value]) => ({
        oid: { id: oid.split(".").map(Number) },
        value: Buffer.from(value),
      }),
    );
  }

  const signedEntity = toSignedEntity(bundleFromJSON(bundleJson));
  try {
    verifier.verify(signedEntity, policy);
  } catch (err) {
    throw new VerifyImageError(
      `Image provenance verification failed: ${err.message}`,
      "VERIFY_FAILED",
    );
  }

  // Assert that the bundle's signed payload targets the digest we fetched.
  // The Referrers API that links a bundle to a digest is registry metadata,
  // not a cryptographic binding — an attacker with package-write access could
  // re-attach a valid bundle to a different image.  This check closes that gap.
  // The DSSE payload parsed by assertSignedDigest is the exact byte sequence covered by the
  // signature that verifier.verify() above just cryptographically verified (same in-memory
  // bundle). @sigstore/verify exposes no accessor for the verified payload, so parsing it
  // directly is both necessary and sound — it is read only after verification succeeds.
  assertSignedDigest(bundleJson, expectedDigest);
}

import { VerifyImageError } from "./errors.ts";

// Encode a string as DER UTF8String for Fulcio OID extension values.
// sigstore-js compares the raw OCTET STRING bytes, so we must include
// the DER tag (0x0C) and length prefix. Assumes len < 128.
export const derUtf8 = (s: string): string => String.fromCharCode(0x0c, s.length) + s;

export interface DsseBundle {
  dsseEnvelope?: {
    payload?: string;
    payloadType?: string;
  };
}

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
 * Exported for unit testing; callers should use sigstore.ts's verifyBundle()
 * instead.
 */
export function assertSignedDigest(bundleJson: DsseBundle, expectedDigest: string): void {
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
      const subjects: { digest?: { sha256?: string } }[] = sl?.subject ?? [];
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
    throw new VerifyImageError("Failed to parse signed payload from bundle", "VERIFY_FAILED");
  }
}

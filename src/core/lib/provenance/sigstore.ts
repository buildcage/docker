import { bundleFromJSON } from "@sigstore/bundle";
import { getTrustedRoot } from "@sigstore/tuf";
import {
  toSignedEntity,
  toTrustMaterial,
  Verifier,
  type ObjectIdentifierValuePair,
  type VerificationPolicy,
} from "@sigstore/verify";
import { VerifyImageError } from "./errors.ts";
import { errorMessage } from "../errors.ts";
import { assertSignedDigest, type DsseBundle } from "./signed-digest.ts";

export interface VerifyBundleOptions {
  certificateIssuer?: string;
  certificateIdentityURI?: string;
  certificateOIDs?: Record<string, string>;
  tlogThreshold?: number;
  ctLogThreshold?: number;
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
 * expectedDigest — "sha256:<hex>" fetched from the registry;
 * must match the digest inside the signed payload.
 */
export async function verifyBundle(
  bundleJson: DsseBundle,
  options: VerifyBundleOptions,
  expectedDigest: string,
): Promise<void> {
  const trustedRoot = await getTrustedRoot();
  const verifier = new Verifier(toTrustMaterial(trustedRoot), {
    ctlogThreshold: options.ctLogThreshold,
    tlogThreshold: options.tlogThreshold,
  });

  const policy: VerificationPolicy = {};
  if (options.certificateIdentityURI) {
    policy.subjectAlternativeName = options.certificateIdentityURI;
  }
  if (options.certificateIssuer) {
    policy.extensions = { issuer: options.certificateIssuer };
  }
  if (options.certificateOIDs) {
    policy.oids = Object.entries(options.certificateOIDs).map(
      ([oid, value]): ObjectIdentifierValuePair => ({
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
      `Image provenance verification failed: ${errorMessage(err)}`,
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

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bundleFromJSON } from "@sigstore/bundle";
import { getTrustedRoot } from "@sigstore/tuf";
import {
  toSignedEntity,
  toTrustMaterial,
  Verifier,
  type ObjectIdentifierValuePair,
  type VerificationPolicy,
} from "@sigstore/verify";

import { errorMessage } from "../errors.ts";
import { VerifyImageError } from "./errors.ts";
import { assertSignedDigest } from "./signed-digest.ts";

export interface VerifyBundleOptions {
  certificateIssuer?: string;
  certificateIdentityURI?: string;
  certificateOIDs?: Record<string, string>;
  tlogThreshold?: number;
  ctLogThreshold?: number;
}

/**
 * An empty cache per call, so TUF starts from the root @sigstore/tuf embeds, not a
 * root.json an earlier job left in the default $HOME cache on a self-hosted runner.
 */
async function fetchTrustedRoot(): ReturnType<typeof getTrustedRoot> {
  const cachePath = await mkdtemp(join(process.env.RUNNER_TEMP || tmpdir(), "buildcage-tuf-"));
  try {
    return await getTrustedRoot({ cachePath });
  } finally {
    await rm(cachePath, { recursive: true, force: true });
  }
}

/**
 * Cryptographically verify a Sigstore Bundle (DSSE format) against a policy,
 * then assert that the bundle's signed manifest digest matches the fetched digest.
 *
 * The bundle's DSSE envelope contains its own signed payload; no external
 * payload is needed for this format.
 *
 * The thresholds default to 1 each. expectedDigest is the "sha256:<hex>"
 * fetched from the registry, and must match the digest inside the signed
 * payload.
 */
export async function verifyBundle(
  bundleJson: unknown,
  options: VerifyBundleOptions,
  expectedDigest: string,
): Promise<void> {
  const trustedRoot = await fetchTrustedRoot();
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

  const bundle = bundleFromJSON(bundleJson);
  // A bundle carrying both kinds parses as a message signature, which says nothing
  // about the DSSE payload the digest is read from.
  if (bundle.content.$case !== "dsseEnvelope") {
    throw new VerifyImageError("Bundle is not a DSSE envelope", "VERIFY_FAILED");
  }
  try {
    verifier.verify(toSignedEntity(bundle), policy);
  } catch (err) {
    throw new VerifyImageError(
      `Image provenance verification failed: ${errorMessage(err)}`,
      "VERIFY_FAILED",
    );
  }

  assertSignedDigest(bundle.content.dsseEnvelope, expectedDigest);
}

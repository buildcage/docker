import type { VerifyBundleOptions } from "./sigstore.ts";
import { derUtf8 } from "./signed-digest.ts";

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

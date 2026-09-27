import { derUtf8 } from "./signed-digest.ts";
import type { VerifyBundleOptions } from "./sigstore.ts";

const EXPECTED_ISSUER = "https://token.actions.githubusercontent.com";
const RELEASE_WORKFLOW = ".github/workflows/docker-publish.yml";

// Fulcio OID: Source Repository Digest, the commit SHA of the build source.
// Value encoding: DER UTF8String ([0x0C, len, ...utf8bytes]) inside OCTET STRING.
const OID_SOURCE_REPO_DIGEST = "1.3.6.1.4.1.57264.1.13";

// A release tag (release.yml's grammar) or the major/minor tag update-major-tag.yml moves.
const RELEASE_REF = /^v\d+(\.\d+(\.\d+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?)?)?$/;

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface VerifyImageIdentity {
  actionRef: string;
  actionRepo: string;
}

/**
 * Build verify options encoding the expected certificate identity.
 *
 * The SAN URI pattern uses `(\.|$)` boundary anchors for version tags so that
 * e.g. @v2.1 matches v2.1.0 and v2.1.3 but not v2.10.0.
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

  // SHA pin: the SAN accepts any v*-prefixed release tag, and the exact commit
  // is pinned by OID 1.13 (Source Repository Digest), which enforces a strict
  // byte match against the pinned SHA and cannot be met by any other commit.
  if (/^[0-9a-f]{40}$/i.test(actionRef)) {
    return {
      ...base,
      certificateIdentityURI: `${sanPrefix}v`,
      certificateOIDs: {
        [OID_SOURCE_REPO_DIGEST]: derUtf8(actionRef.toLowerCase()),
      },
    };
  }

  if (RELEASE_REF.test(actionRef)) {
    return {
      ...base,
      certificateIdentityURI: `${sanPrefix}${escapeRegex(actionRef)}(\\.|$)`,
    };
  }

  return null; // branch name, local ./setup and so on: no verifiable release bundle
}

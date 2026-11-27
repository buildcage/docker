import { VerifyImageError } from "./errors.ts";
import { derUtf8 } from "./signed-digest.ts";
import type { VerifyBundleOptions } from "./sigstore.ts";

const EXPECTED_ISSUER = "https://token.actions.githubusercontent.com";
const RELEASE_WORKFLOW = ".github/workflows/docker-publish.yml";

// Fulcio OIDs. Each value is a DER UTF8String ([0x0C, len, ...utf8bytes]) inside OCTET STRING.
/** Runner Environment: `github-hosted` or `self-hosted`. */
const OID_RUNNER_ENVIRONMENT = "1.3.6.1.4.1.57264.1.11";
/** Source Repository Digest: the commit SHA the workflow run checked out. */
const OID_SOURCE_REPO_DIGEST = "1.3.6.1.4.1.57264.1.13";
/** Source Repository Ref: the ref the workflow run was triggered on. */
const OID_SOURCE_REPO_REF = "1.3.6.1.4.1.57264.1.14";
/** Build Config Digest: the commit of the top-level workflow, which differs under a reusable workflow. */
const OID_BUILD_CONFIG_DIGEST = "1.3.6.1.4.1.57264.1.19";

const SHA_REF = /^[0-9a-f]{40}$/i;

// A release tag (release.yml's grammar) or the major/minor tag update-major-tag.yml moves.
const RELEASE_REF = /^v(\d+(?:\.\d+(?:\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?)?)?)$/;

// What package.json's version may hold: a full release version, prerelease included.
const RELEASE_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$/;

// derUtf8 writes a one-byte length, so `refs/tags/v<version>` has to stay under 128.
const MAX_VERSION_LENGTH = 100;

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// GitHub resolves `uses:` owner/repo case-insensitively and passes it on as
// written, while the SAN carries the canonical case. Only this part ignores
// case: V2.1.0 is a different tag.
const caseInsensitive = (s: string): string =>
  escapeRegex(s).replace(/[A-Za-z]/g, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`);

/**
 * How to find the commit the image must be built from: the pinned SHA itself,
 * or the release tag of this build's own version.
 */
export type ReleaseTarget = { kind: "commit"; commit: string } | { kind: "tag" };

export interface ReleaseTargetInput {
  actionRef: string;
  /** This build's version, from package.json. */
  actionVersion: string;
}

/**
 * Work out how to find the release commit for `actionRef`.
 *
 * The version comes from the running code, not the ref: under a workflow
 * lockfile the ref still reads `v4` while the runner runs the locked commit,
 * so only the code knows which release it is.
 *
 * Returns null for unverifiable refs (branch names, local paths).
 *
 * @throws {VerifyImageError} VERIFY_FAILED if the version is malformed, or the
 *   ref is a release ref this version does not fall under
 */
export function releaseTarget({
  actionRef,
  actionVersion,
}: ReleaseTargetInput): ReleaseTarget | null {
  if (actionVersion.length > MAX_VERSION_LENGTH || !RELEASE_VERSION.test(actionVersion)) {
    throw new VerifyImageError(
      `This build has no release version (package.json version ${JSON.stringify(actionVersion)}).`,
      "VERIFY_FAILED",
    );
  }

  if (SHA_REF.test(actionRef)) {
    return { kind: "commit", commit: actionRef.toLowerCase() };
  }

  const match = RELEASE_REF.exec(actionRef);
  if (!match) return null; // branch name, local ./setup and so on: no verifiable release bundle

  const requested = match[1];
  const full = /^\d+\.\d+\.\d+/.test(requested);
  const covered = full
    ? actionVersion === requested
    : actionVersion.startsWith(`${requested}.`) && !actionVersion.includes("-");
  if (!covered) {
    throw new VerifyImageError(
      `The action ref ${actionRef} does not cover this action's version v${actionVersion}` +
        (full ? "." : ", or that version is a prerelease."),
      "VERIFY_FAILED",
    );
  }
  return { kind: "tag" };
}

export interface VerifyPolicyInput {
  actionRepo: string;
  actionVersion: string;
  /** The release commit the image must be built from. */
  commit: string;
}

/**
 * Build verify options requiring the image to be signed by docker-publish.yml
 * run on this version's release tag, on a GitHub-hosted runner, from `commit`.
 */
export function buildVerifyOptions({
  actionRepo,
  actionVersion,
  commit,
}: VerifyPolicyInput): VerifyBundleOptions {
  const tagRef = `refs/tags/v${actionVersion}`;
  return {
    certificateIssuer: EXPECTED_ISSUER,
    certificateIdentityURI:
      `^${escapeRegex("https://github.com/")}${caseInsensitive(actionRepo)}` +
      `${escapeRegex(`/${RELEASE_WORKFLOW}@${tagRef}`)}$`,
    certificateOIDs: {
      [OID_RUNNER_ENVIRONMENT]: derUtf8("github-hosted"),
      [OID_SOURCE_REPO_DIGEST]: derUtf8(commit),
      [OID_SOURCE_REPO_REF]: derUtf8(tagRef),
      [OID_BUILD_CONFIG_DIGEST]: derUtf8(commit),
    },
    tlogThreshold: 1,
    ctLogThreshold: 1,
  };
}

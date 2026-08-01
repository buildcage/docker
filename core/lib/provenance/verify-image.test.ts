/**
 * Unit tests for core/lib/verify-image.ts
 *
 * Tests focus on buildcage-specific pure functions: imageTagFromRef and
 * buildVerifyOptions.  I/O functions (getManifestDigest, fetchRegistryToken,
 * fetchBundle) are tested in lib/oci-registry.test.ts.
 *
 * verifyBundle and verifyImageDigest require a live TUF network call; those
 * paths are covered by end-to-end / integration tests.
 *
 * Run with: node --test core/lib/provenance/verify-image.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { imageTagFromRef, buildVerifyOptions, verifyImageDigestOrThrow } from "./verify-image.ts";
import { ProvenanceError, VerifyImageError } from "./errors.ts";
import type { VerifyBundleOptions } from "./sigstore.ts";

// ── Constants mirrored from verify-image.ts (for assertion readability) ──────

const EXPECTED_ISSUER = "https://token.actions.githubusercontent.com";
const RELEASE_WORKFLOW = ".github/workflows/docker-publish.yml";
const OID_SOURCE_REPO_DIGEST = "1.3.6.1.4.1.57264.1.13";
const REPO = "dash14/buildcage";

/** Build a sample SAN URI as Fulcio would embed it. */
function makeSAN(ref: string) {
  return `https://github.com/${REPO}/${RELEASE_WORKFLOW}@${ref}`;
}

// ── imageTagFromRef ───────────────────────────────────────────────────────────

describe("imageTagFromRef", () => {
  it("converts a 40-char hex SHA to sha-<sha> by default (no suffix for transparent)", () => {
    const sha = "a".repeat(40);
    assert.equal(imageTagFromRef(sha), `sha-${"a".repeat(40)}`);
  });

  it("lowercases the SHA", () => {
    const sha = "ABCDEF1234".padEnd(40, "0");
    assert.equal(imageTagFromRef(sha), `sha-${sha.toLowerCase()}`);
  });

  it("strips leading 'v' from a version tag", () => {
    assert.equal(imageTagFromRef("v2.1.0"), "2.1.0");
  });

  it("strips 'v' from a major-only tag", () => {
    assert.equal(imageTagFromRef("v2"), "2");
  });

  it("returns a branch name as-is, with no suffix for the default engine", () => {
    assert.equal(imageTagFromRef("main"), "main");
  });

  it("returns empty string for empty input", () => {
    assert.equal(imageTagFromRef(""), "");
  });

  it("returns empty string for undefined", () => {
    assert.equal(imageTagFromRef(undefined), "");
  });

  it("appends the explicit engine suffix instead when requested", () => {
    assert.equal(imageTagFromRef("v2.1.0", "explicit"), "2.1.0-explicit");
    assert.equal(imageTagFromRef("a".repeat(40), "explicit"), `sha-${"a".repeat(40)}-explicit`);
  });
});

// ── buildVerifyOptions ────────────────────────────────────────────────────────
//
// We test the generated options by converting certificateIdentityURI to a
// RegExp and matching sample SAN strings — the same test cosign would apply.

describe("buildVerifyOptions — version tag", () => {
  function getOpts(ref: string): VerifyBundleOptions {
    const opts = buildVerifyOptions({ actionRef: ref, actionRepo: REPO });
    assert.ok(opts, `expected non-null options for ref "${ref}"`);
    return opts!;
  }
  function matchesSAN(opts: VerifyBundleOptions, san: string) {
    return new RegExp(opts.certificateIdentityURI!).test(san);
  }

  it("sets certificateIssuer", () => {
    const opts = getOpts("v2.1.0");
    assert.equal(opts.certificateIssuer, EXPECTED_ISSUER);
  });

  it("matches exact full version @v2.1.0 against cert SAN v2.1.0", () => {
    const opts = getOpts("v2.1.0");
    assert.ok(matchesSAN(opts, makeSAN("refs/tags/v2.1.0")));
  });

  it("matches floating minor @v2.1 against cert SAN v2.1.3", () => {
    const opts = getOpts("v2.1");
    assert.ok(matchesSAN(opts, makeSAN("refs/tags/v2.1.3")));
  });

  it("matches floating major @v2 against cert SAN v2.99.0", () => {
    const opts = getOpts("v2");
    assert.ok(matchesSAN(opts, makeSAN("refs/tags/v2.99.0")));
  });

  // ── v2.1 / v2.10 boundary ───────────────────────────────────────────────────
  it("does NOT match @v2.1 against cert SAN v2.10.0 (boundary check)", () => {
    const opts = getOpts("v2.1");
    assert.ok(!matchesSAN(opts, makeSAN("refs/tags/v2.10.0")), "@v2.1 must not match v2.10.0");
  });

  it("does NOT match @v2 against cert SAN v20.0.0 (boundary check)", () => {
    const opts = getOpts("v2");
    assert.ok(!matchesSAN(opts, makeSAN("refs/tags/v20.0.0")), "@v2 must not match v20.0.0");
  });

  it("does NOT match @v2.1.0 against cert SAN v2.1.1", () => {
    const opts = getOpts("v2.1.0");
    assert.ok(
      !matchesSAN(opts, makeSAN("refs/tags/v2.1.1")),
      "exact pin must not match different patch",
    );
  });

  it("does NOT match @v2.1 against cert SAN v2.2.0", () => {
    const opts = getOpts("v2.1");
    assert.ok(!matchesSAN(opts, makeSAN("refs/tags/v2.2.0")), "@v2.1 must not match v2.2.0");
  });

  it("has no certificateOIDs for version tags", () => {
    const opts = getOpts("v2.1.0");
    assert.equal(opts.certificateOIDs, undefined);
  });
});

describe("buildVerifyOptions — SHA pin", () => {
  const pinSha = "a".repeat(40);

  it("sets certificateIssuer", () => {
    const opts = buildVerifyOptions({ actionRef: pinSha, actionRepo: REPO })!;
    assert.equal(opts.certificateIssuer, EXPECTED_ISSUER);
  });

  it("sets certificateOIDs for OID 1.13 with DER UTF8String-encoded SHA", () => {
    const opts = buildVerifyOptions({ actionRef: pinSha, actionRepo: REPO })!;
    assert.ok(opts.certificateOIDs, "certificateOIDs must be present for SHA pin");
    const oidValue = opts.certificateOIDs![OID_SOURCE_REPO_DIGEST];
    assert.ok(oidValue !== undefined, `OID ${OID_SOURCE_REPO_DIGEST} must be set`);

    // DER UTF8String: [0x0C, len, ...utf8bytes]
    const expected = Buffer.concat([
      Buffer.from([0x0c, pinSha.length]),
      Buffer.from(pinSha, "utf8"),
    ]);
    assert.deepEqual(Buffer.from(oidValue, "binary"), expected);
  });

  it("lowercases the SHA in the OID value", () => {
    const opts = buildVerifyOptions({ actionRef: pinSha.toUpperCase(), actionRepo: REPO })!;
    const oidValue = opts.certificateOIDs![OID_SOURCE_REPO_DIGEST];
    assert.ok(oidValue.includes(pinSha.toLowerCase()), "SHA must be lowercased");
  });

  it("certificateIdentityURI accepts any version tag SAN (SHA checked via OID)", () => {
    const opts = buildVerifyOptions({ actionRef: pinSha, actionRepo: REPO })!;
    const regexp = new RegExp(opts.certificateIdentityURI!);
    // should match some version tags (the SHA in OID is what pins to the commit)
    assert.ok(regexp.test(makeSAN("refs/tags/v2.1.0")));
    assert.ok(regexp.test(makeSAN("refs/tags/v3.0.0")));
  });
});

describe("buildVerifyOptions — unverifiable refs", () => {
  it("returns null for a branch ref", () => {
    assert.equal(buildVerifyOptions({ actionRef: "main", actionRepo: REPO }), null);
  });

  it("returns null for a local ./setup ref", () => {
    assert.equal(buildVerifyOptions({ actionRef: "./setup", actionRepo: REPO }), null);
  });

  it("returns null for an empty ref", () => {
    assert.equal(buildVerifyOptions({ actionRef: "", actionRepo: REPO }), null);
  });
});

describe("verifyImageDigestOrThrow", () => {
  it("returns the digest on success", async () => {
    const digest = await verifyImageDigestOrThrow({
      actionRef: "v2.1.0",
      actionRepo: REPO,
      proxyEngine: "transparent",
      verifyImageDigestFn: async () => "sha256:abc123",
    });
    assert.equal(digest, "sha256:abc123");
  });

  it("throws ProvenanceError carrying the original VerifyImageError's code on failure", async () => {
    await assert.rejects(
      () =>
        verifyImageDigestOrThrow({
          actionRef: "v2.1.0",
          actionRepo: REPO,
          proxyEngine: "transparent",
          verifyImageDigestFn: async () => {
            throw new VerifyImageError("registry token request failed", "TOKEN_ERROR");
          },
        }),
      (err: unknown) =>
        err instanceof ProvenanceError &&
        err.code === "TOKEN_ERROR" &&
        err.message === "registry token request failed",
    );
  });

  it("defaults to VERIFY_FAILED when the original error has no code", async () => {
    await assert.rejects(
      () =>
        verifyImageDigestOrThrow({
          actionRef: "v2.1.0",
          actionRepo: REPO,
          proxyEngine: "transparent",
          verifyImageDigestFn: async () => {
            throw new Error("boom");
          },
        }),
      (err: unknown) => err instanceof ProvenanceError && err.code === "VERIFY_FAILED",
    );
  });

  it("throws ProvenanceError with UNVERIFIABLE_REF when the digest is null", async () => {
    await assert.rejects(
      () =>
        verifyImageDigestOrThrow({
          actionRef: "main",
          actionRepo: REPO,
          proxyEngine: "transparent",
          verifyImageDigestFn: async () => null,
        }),
      (err: unknown) => err instanceof ProvenanceError && err.code === "UNVERIFIABLE_REF",
    );
  });
});

/**
 * Unit tests for core/lib/provenance/verify-image.ts
 *
 * Covers the orchestration-level pure functions only (toProvenanceError,
 * requireDigest) — imageTagFromRef and buildVerifyOptions have their own
 * test files (image-tag.test.ts, verify-policy.test.ts). I/O functions
 * (verifyImageDigest, verifyImageDigestOrThrow, and the registry/sigstore
 * calls they make) require a live network/TUF call and are covered by
 * end-to-end / integration tests instead.
 *
 * Run with: vp test run core/lib/provenance/verify-image.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { toProvenanceError, requireDigest } from "./verify-image.ts";
import { ProvenanceError, VerifyImageError } from "./errors.ts";

// The network/sigstore-calling success path is covered by end-to-end /
// integration tests instead (see the file header).
describe("toProvenanceError", () => {
  it("carries the original VerifyImageError's code and message through", () => {
    const err = toProvenanceError(
      new VerifyImageError("registry token request failed", "TOKEN_ERROR"),
    );
    assert.ok(err instanceof ProvenanceError);
    assert.equal(err.code, "TOKEN_ERROR");
    assert.equal(err.message, "registry token request failed");
  });

  it("defaults to VERIFY_FAILED when the original error has no code", () => {
    const err = toProvenanceError(new Error("boom"));
    assert.ok(err instanceof ProvenanceError);
    assert.equal(err.code, "VERIFY_FAILED");
  });
});

describe("requireDigest", () => {
  it("returns the digest when non-null", () => {
    assert.equal(requireDigest("sha256:abc123", "v2.1.0"), "sha256:abc123");
  });

  it("throws ProvenanceError with UNVERIFIABLE_REF when the digest is null", () => {
    assert.throws(
      () => requireDigest(null, "main"),
      (err: unknown) => err instanceof ProvenanceError && err.code === "UNVERIFIABLE_REF",
    );
  });
});

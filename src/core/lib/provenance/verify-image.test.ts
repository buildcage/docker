/**
 * Covers the orchestration-level pure functions only (toProvenanceError,
 * requireDigest); imageTagFromRef and buildVerifyOptions have their own test
 * files (image-tag.test.ts, verify-policy.test.ts). The I/O functions
 * (verifyImageDigest, verifyImageDigestOrThrow, and the registry and sigstore
 * calls they make) need a live network or TUF call and are covered by the
 * end-to-end tests instead.
 */
import { describe, it, expect } from "vitest";

import { ProvenanceError, VerifyImageError } from "./errors.ts";
import { toProvenanceError, requireDigest } from "./verify-image.ts";

describe("toProvenanceError", () => {
  it("carries the original VerifyImageError's code and message through", () => {
    const err = toProvenanceError(
      new VerifyImageError("registry token request failed", "TOKEN_ERROR"),
    );
    expect(err instanceof ProvenanceError).toBeTruthy();
    expect(err.code).toBe("TOKEN_ERROR");
    expect(err.message).toBe("registry token request failed");
  });

  it("defaults to VERIFY_FAILED when the original error has no code", () => {
    const err = toProvenanceError(new Error("boom"));
    expect(err instanceof ProvenanceError).toBeTruthy();
    expect(err.code).toBe("VERIFY_FAILED");
  });
});

describe("requireDigest", () => {
  it("returns the digest when non-null", () => {
    expect(requireDigest("sha256:abc123", "v2.1.0")).toBe("sha256:abc123");
  });

  it("throws ProvenanceError with UNVERIFIABLE_REF when the digest is null", () => {
    expect.assertions(2);
    try {
      requireDigest(null, "main");
    } catch (err) {
      expect(err).toBeInstanceOf(ProvenanceError);
      expect((err as ProvenanceError).code).toBe("UNVERIFIABLE_REF");
    }
  });
});

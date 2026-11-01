/**
 * Covers the orchestration-level functions that take no live calls
 * (toProvenanceError, requireDigest, verifyWhilePulling); imageTagFromRef and buildVerifyOptions have their own test
 * files (image-tag.test.ts, verify-policy.test.ts). verifyImageDigest and
 * verifyImageDigestOrThrow chain live registry and TUF calls and are left to
 * the end-to-end tests; each call they make has its own test file.
 */
import { describe, it, expect, vi } from "vitest";

import type { ImagePull } from "../docker/image-pull.ts";
import { ProvenanceError, VerifyImageError } from "./errors.ts";
import {
  toProvenanceError,
  requireDigest,
  verifyWhilePulling,
  type VerifyImageDigestOptions,
} from "./verify-image.ts";

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

describe("verifyWhilePulling", () => {
  const DIGEST = "sha256:" + "a".repeat(64);
  const IDENTITY = { actionRef: "v2.1.0", actionRepo: "Buildcage/Example", proxyEngine: "inspect" };

  function fakePull(): ImagePull {
    return { finished: Promise.resolve(), cancel: vi.fn() };
  }

  it("starts the pull by digest once the digest is known, before verification ends", async () => {
    const order: string[] = [];
    const pull = fakePull();
    const startImagePull = vi.fn((ref: string) => {
      order.push(`pull ${ref}`);
      return pull;
    });
    const verifyImageDigestOrThrow = vi.fn(async ({ onDigest }: VerifyImageDigestOptions) => {
      onDigest?.(DIGEST);
      order.push("verified");
      return DIGEST;
    });

    const result = await verifyWhilePulling(IDENTITY, {
      verifyImageDigestOrThrow,
      startImagePull,
    });

    expect(order).toStrictEqual([`pull ghcr.io/buildcage/example@${DIGEST}`, "verified"]);
    expect(verifyImageDigestOrThrow).toHaveBeenCalledWith(expect.objectContaining(IDENTITY));
    expect(result).toStrictEqual({
      digest: DIGEST,
      imageRef: `ghcr.io/buildcage/example@${DIGEST}`,
      pull,
    });
    expect(pull.cancel).not.toHaveBeenCalled();
  });

  it("stops the pull and rethrows when verification fails after the digest was known", async () => {
    const pull = fakePull();
    const failure = new ProvenanceError("bad signature", "VERIFY_FAILED");

    await expect(
      verifyWhilePulling(IDENTITY, {
        verifyImageDigestOrThrow: async ({ onDigest }) => {
          onDigest?.(DIGEST);
          throw failure;
        },
        startImagePull: () => pull,
      }),
    ).rejects.toBe(failure);
    expect(pull.cancel).toHaveBeenCalledOnce();
  });

  it("starts no pull when verification fails before the digest is known", async () => {
    const startImagePull = vi.fn(fakePull);

    await expect(
      verifyWhilePulling(IDENTITY, {
        verifyImageDigestOrThrow: async () => {
          throw new ProvenanceError("unverifiable", "UNVERIFIABLE_REF");
        },
        startImagePull,
      }),
    ).rejects.toThrow("unverifiable");
    expect(startImagePull).not.toHaveBeenCalled();
  });

  it("starts the pull after verification when the digest was never reported early", async () => {
    const pull = fakePull();
    const startImagePull = vi.fn(() => pull);

    const result = await verifyWhilePulling(IDENTITY, {
      verifyImageDigestOrThrow: async () => DIGEST,
      startImagePull,
    });

    expect(startImagePull).toHaveBeenCalledExactlyOnceWith(`ghcr.io/buildcage/example@${DIGEST}`);
    expect(result.pull).toBe(pull);
  });
});

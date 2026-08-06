/**
 * Unit tests for core/lib/provenance/signed-digest.ts
 *
 * assertSignedDigest() is pure synchronous logic and is fully unit-tested here.
 * sigstore.ts's verifyBundle() requires a live TUF network call; that path
 * is covered by end-to-end / integration tests instead.
 *
 * Run with: vp test run core/lib/provenance/signed-digest.test.ts
 */

import { describe, it, expect } from "vitest";
import { assertSignedDigest } from "./signed-digest.ts";
import { VerifyImageError } from "./errors.ts";

const DIGEST = "sha256:abc123";

/**
 * Build a minimal DSSE bundle JSON.
 * - payloadType omitted / "simple-signing": legacy critical.image format
 * - payloadType "application/vnd.in-toto+json": in-toto Statement v1 format
 */
interface SubjectDigest {
  sha256?: string;
  md5?: string;
}

interface Subject {
  digest: SubjectDigest;
  annotations: object;
}

interface MakeBundleOptions {
  payloadType?: string;
  subjects?: Subject[];
}

function makeBundle(signedDigest: string, { payloadType, subjects }: MakeBundleOptions = {}) {
  let payloadObj;
  if (payloadType === "application/vnd.in-toto+json") {
    const subjectList = subjects ?? [
      { digest: { sha256: signedDigest.replace(/^sha256:/, "") }, annotations: {} },
    ];
    payloadObj = {
      _type: "https://in-toto.io/Statement/v1",
      subject: subjectList,
      predicateType: "https://sigstore.dev/cosign/sign/v1",
      predicate: {},
    };
  } else {
    payloadObj = {
      critical: {
        image: { "docker-manifest-digest": signedDigest },
      },
    };
  }
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString("base64");
  const dsse = payloadType ? { payload, payloadType } : { payload };
  return { dsseEnvelope: dsse };
}

describe("assertSignedDigest — simple-signing (legacy)", () => {
  it("passes when the signed digest matches the expected digest", () => {
    expect(() => assertSignedDigest(makeBundle(DIGEST), DIGEST)).not.toThrow();
  });

  it("throws VERIFY_FAILED when the signed digest does not match", () => {
    expect.assertions(3);
    try {
      assertSignedDigest(makeBundle("sha256:different"), DIGEST);
    } catch (err) {
      expect(err).toBeInstanceOf(VerifyImageError);
      expect((err as VerifyImageError).code).toBe("VERIFY_FAILED");
      expect((err as VerifyImageError).message).toMatch(/does not match/);
    }
  });

  it("throws VERIFY_FAILED when the signed digest field is missing", () => {
    const payload = Buffer.from(JSON.stringify({ critical: { image: {} } })).toString("base64");
    const bundle = { dsseEnvelope: { payload } };
    expect.assertions(3);
    try {
      assertSignedDigest(bundle, DIGEST);
    } catch (err) {
      expect(err).toBeInstanceOf(VerifyImageError);
      expect((err as VerifyImageError).code).toBe("VERIFY_FAILED");
      expect((err as VerifyImageError).message).toMatch(/missing/);
    }
  });

  it("throws VERIFY_FAILED when the DSSE payload field is absent", () => {
    expect.assertions(3);
    try {
      assertSignedDigest({ dsseEnvelope: {} }, DIGEST);
    } catch (err) {
      expect(err).toBeInstanceOf(VerifyImageError);
      expect((err as VerifyImageError).code).toBe("VERIFY_FAILED");
      expect((err as VerifyImageError).message).toMatch(/missing a signed payload/);
    }
  });

  it("throws VERIFY_FAILED when dsseEnvelope is absent", () => {
    expect.assertions(2);
    try {
      assertSignedDigest({}, DIGEST);
    } catch (err) {
      expect(err).toBeInstanceOf(VerifyImageError);
      expect((err as VerifyImageError).code).toBe("VERIFY_FAILED");
    }
  });

  it("throws VERIFY_FAILED when the payload is not valid base64 JSON", () => {
    const bundle = { dsseEnvelope: { payload: "!!!not-base64!!!" } };
    expect.assertions(2);
    try {
      assertSignedDigest(bundle, DIGEST);
    } catch (err) {
      expect(err).toBeInstanceOf(VerifyImageError);
      expect((err as VerifyImageError).code).toBe("VERIFY_FAILED");
    }
  });
});

const IN_TOTO = "application/vnd.in-toto+json";

describe("assertSignedDigest — in-toto Statement v1 (cosign --new-bundle-format)", () => {
  it("passes when subject[0].digest.sha256 matches the expected digest", () => {
    expect(() =>
      assertSignedDigest(makeBundle(DIGEST, { payloadType: IN_TOTO }), DIGEST),
    ).not.toThrow();
  });

  it("passes when one of multiple subjects matches (others do not)", () => {
    const bundle = makeBundle(DIGEST, {
      payloadType: IN_TOTO,
      subjects: [
        { digest: { sha256: "000other" }, annotations: {} },
        { digest: { sha256: DIGEST.replace(/^sha256:/, "") }, annotations: {} },
      ],
    });
    expect(() => assertSignedDigest(bundle, DIGEST)).not.toThrow();
  });

  it("throws VERIFY_FAILED when subject digest does not match", () => {
    expect.assertions(3);
    try {
      assertSignedDigest(makeBundle("sha256:different", { payloadType: IN_TOTO }), DIGEST);
    } catch (err) {
      expect(err).toBeInstanceOf(VerifyImageError);
      expect((err as VerifyImageError).code).toBe("VERIFY_FAILED");
      expect((err as VerifyImageError).message).toMatch(/does not match/);
    }
  });

  it("throws VERIFY_FAILED when subject array is empty", () => {
    const bundle = makeBundle(DIGEST, { payloadType: IN_TOTO, subjects: [] });
    expect.assertions(3);
    try {
      assertSignedDigest(bundle, DIGEST);
    } catch (err) {
      expect(err).toBeInstanceOf(VerifyImageError);
      expect((err as VerifyImageError).code).toBe("VERIFY_FAILED");
      expect((err as VerifyImageError).message).toMatch(/missing/);
    }
  });

  it("throws VERIFY_FAILED when subject has no sha256 field", () => {
    const bundle = makeBundle(DIGEST, {
      payloadType: IN_TOTO,
      subjects: [{ digest: { md5: "notsha256" }, annotations: {} }],
    });
    expect.assertions(2);
    try {
      assertSignedDigest(bundle, DIGEST);
    } catch (err) {
      expect(err).toBeInstanceOf(VerifyImageError);
      expect((err as VerifyImageError).code).toBe("VERIFY_FAILED");
    }
  });
});

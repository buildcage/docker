/**
 * assertSignedDigest() is pure synchronous logic, fully unit-tested here.
 * sigstore.ts's verifyBundle(), which calls it, is covered in sigstore.test.ts
 * against a mocked trust root and verifier.
 */

import { describe, it, expect } from "vitest";

import { VerifyImageError } from "./errors.ts";
import { assertSignedDigest } from "./signed-digest.ts";

const DIGEST = "sha256:abc123";

interface SubjectDigest {
  sha256?: string;
  md5?: string;
}

interface Subject {
  digest: SubjectDigest;
  annotations: object;
}

const SIMPLE_SIGNING = "application/vnd.dev.cosign.simplesigning.v1+json";

interface MakeEnvelopeOptions {
  payloadType?: string;
  subjects?: Subject[];
}

function makeEnvelope(
  signedDigest: string,
  { payloadType = SIMPLE_SIGNING, subjects }: MakeEnvelopeOptions = {},
) {
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
  return { payload: Buffer.from(JSON.stringify(payloadObj)), payloadType };
}

describe("assertSignedDigest: simple-signing (legacy)", () => {
  it("passes when the signed digest matches the expected digest", () => {
    expect(() => assertSignedDigest(makeEnvelope(DIGEST), DIGEST)).not.toThrow();
  });

  it("throws VERIFY_FAILED when the signed digest does not match", () => {
    expect.assertions(3);
    try {
      assertSignedDigest(makeEnvelope("sha256:different"), DIGEST);
    } catch (err) {
      expect(err).toBeInstanceOf(VerifyImageError);
      expect((err as VerifyImageError).code).toBe("VERIFY_FAILED");
      expect((err as VerifyImageError).message).toMatch(/does not match/);
    }
  });

  it("throws VERIFY_FAILED when the signed digest field is missing", () => {
    const envelope = {
      payload: Buffer.from(JSON.stringify({ critical: { image: {} } })),
      payloadType: SIMPLE_SIGNING,
    };
    expect.assertions(3);
    try {
      assertSignedDigest(envelope, DIGEST);
    } catch (err) {
      expect(err).toBeInstanceOf(VerifyImageError);
      expect((err as VerifyImageError).code).toBe("VERIFY_FAILED");
      expect((err as VerifyImageError).message).toMatch(/missing/);
    }
  });

  it("throws VERIFY_FAILED when the DSSE payload is empty", () => {
    expect.assertions(3);
    try {
      assertSignedDigest({ payload: Buffer.alloc(0), payloadType: SIMPLE_SIGNING }, DIGEST);
    } catch (err) {
      expect(err).toBeInstanceOf(VerifyImageError);
      expect((err as VerifyImageError).code).toBe("VERIFY_FAILED");
      expect((err as VerifyImageError).message).toMatch(/missing a signed payload/);
    }
  });

  it("throws VERIFY_FAILED when the payload is not valid JSON", () => {
    const envelope = { payload: Buffer.from("not json"), payloadType: SIMPLE_SIGNING };
    expect.assertions(2);
    try {
      assertSignedDigest(envelope, DIGEST);
    } catch (err) {
      expect(err).toBeInstanceOf(VerifyImageError);
      expect((err as VerifyImageError).code).toBe("VERIFY_FAILED");
    }
  });
});

const IN_TOTO = "application/vnd.in-toto+json";

describe("assertSignedDigest: in-toto Statement v1 (cosign --new-bundle-format)", () => {
  it("passes when subject[0].digest.sha256 matches the expected digest", () => {
    expect(() =>
      assertSignedDigest(makeEnvelope(DIGEST, { payloadType: IN_TOTO }), DIGEST),
    ).not.toThrow();
  });

  it("passes when one of multiple subjects matches (others do not)", () => {
    const envelope = makeEnvelope(DIGEST, {
      payloadType: IN_TOTO,
      subjects: [
        { digest: { sha256: "000other" }, annotations: {} },
        { digest: { sha256: DIGEST.replace(/^sha256:/, "") }, annotations: {} },
      ],
    });
    expect(() => assertSignedDigest(envelope, DIGEST)).not.toThrow();
  });

  it("throws VERIFY_FAILED when subject digest does not match", () => {
    expect.assertions(3);
    try {
      assertSignedDigest(makeEnvelope("sha256:different", { payloadType: IN_TOTO }), DIGEST);
    } catch (err) {
      expect(err).toBeInstanceOf(VerifyImageError);
      expect((err as VerifyImageError).code).toBe("VERIFY_FAILED");
      expect((err as VerifyImageError).message).toMatch(/does not match/);
    }
  });

  it("throws VERIFY_FAILED when subject array is empty", () => {
    const envelope = makeEnvelope(DIGEST, { payloadType: IN_TOTO, subjects: [] });
    expect.assertions(3);
    try {
      assertSignedDigest(envelope, DIGEST);
    } catch (err) {
      expect(err).toBeInstanceOf(VerifyImageError);
      expect((err as VerifyImageError).code).toBe("VERIFY_FAILED");
      expect((err as VerifyImageError).message).toMatch(/missing/);
    }
  });

  it("throws VERIFY_FAILED when subject has no sha256 field", () => {
    const envelope = makeEnvelope(DIGEST, {
      payloadType: IN_TOTO,
      subjects: [{ digest: { md5: "notsha256" }, annotations: {} }],
    });
    expect.assertions(2);
    try {
      assertSignedDigest(envelope, DIGEST);
    } catch (err) {
      expect(err).toBeInstanceOf(VerifyImageError);
      expect((err as VerifyImageError).code).toBe("VERIFY_FAILED");
    }
  });
});

describe("an in-toto payload with no subject at all", () => {
  it("refuses it rather than treating the empty list as a match", () => {
    const envelope = { payload: Buffer.from("{}"), payloadType: IN_TOTO };
    expect(() => assertSignedDigest(envelope, DIGEST)).toThrow(/does not match/);
  });
});

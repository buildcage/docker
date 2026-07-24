/**
 * Unit tests for core/lib/sigstore.ts
 *
 * verifyBundle() requires a live TUF network call; that path is covered by
 * end-to-end / integration tests.
 *
 * assertSignedDigest() is pure synchronous logic and is fully unit-tested here.
 *
 * Run with: node --test core/lib/provenance/sigstore.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertSignedDigest } from "./sigstore.ts";
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

function makeBundle(
  signedDigest: string,
  { payloadType, subjects }: MakeBundleOptions = {},
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
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString("base64");
  const dsse = payloadType ? { payload, payloadType } : { payload };
  return { dsseEnvelope: dsse };
}

describe("assertSignedDigest — simple-signing (legacy)", () => {
  it("passes when the signed digest matches the expected digest", () => {
    assert.doesNotThrow(() => assertSignedDigest(makeBundle(DIGEST), DIGEST));
  });

  it("throws VERIFY_FAILED when the signed digest does not match", () => {
    assert.throws(
      () => assertSignedDigest(makeBundle("sha256:different"), DIGEST),
      (err: unknown) => {
        assert.ok(err instanceof VerifyImageError);
        assert.equal(err.code, "VERIFY_FAILED");
        assert.match(err.message, /does not match/);
        return true;
      },
    );
  });

  it("throws VERIFY_FAILED when the signed digest field is missing", () => {
    const payload = Buffer.from(JSON.stringify({ critical: { image: {} } })).toString("base64");
    const bundle = { dsseEnvelope: { payload } };
    assert.throws(
      () => assertSignedDigest(bundle, DIGEST),
      (err: unknown) => {
        assert.ok(err instanceof VerifyImageError);
        assert.equal(err.code, "VERIFY_FAILED");
        assert.match(err.message, /missing/);
        return true;
      },
    );
  });

  it("throws VERIFY_FAILED when the DSSE payload field is absent", () => {
    assert.throws(
      () => assertSignedDigest({ dsseEnvelope: {} }, DIGEST),
      (err: unknown) => {
        assert.ok(err instanceof VerifyImageError);
        assert.equal(err.code, "VERIFY_FAILED");
        assert.match(err.message, /missing a signed payload/);
        return true;
      },
    );
  });

  it("throws VERIFY_FAILED when dsseEnvelope is absent", () => {
    assert.throws(
      () => assertSignedDigest({}, DIGEST),
      (err: unknown) => {
        assert.ok(err instanceof VerifyImageError);
        assert.equal(err.code, "VERIFY_FAILED");
        return true;
      },
    );
  });

  it("throws VERIFY_FAILED when the payload is not valid base64 JSON", () => {
    const bundle = { dsseEnvelope: { payload: "!!!not-base64!!!" } };
    assert.throws(
      () => assertSignedDigest(bundle, DIGEST),
      (err: unknown) => {
        assert.ok(err instanceof VerifyImageError);
        assert.equal(err.code, "VERIFY_FAILED");
        return true;
      },
    );
  });
});

const IN_TOTO = "application/vnd.in-toto+json";

describe("assertSignedDigest — in-toto Statement v1 (cosign --new-bundle-format)", () => {
  it("passes when subject[0].digest.sha256 matches the expected digest", () => {
    assert.doesNotThrow(() =>
      assertSignedDigest(makeBundle(DIGEST, { payloadType: IN_TOTO }), DIGEST),
    );
  });

  it("passes when one of multiple subjects matches (others do not)", () => {
    const bundle = makeBundle(DIGEST, {
      payloadType: IN_TOTO,
      subjects: [
        { digest: { sha256: "000other" }, annotations: {} },
        { digest: { sha256: DIGEST.replace(/^sha256:/, "") }, annotations: {} },
      ],
    });
    assert.doesNotThrow(() => assertSignedDigest(bundle, DIGEST));
  });

  it("throws VERIFY_FAILED when subject digest does not match", () => {
    assert.throws(
      () =>
        assertSignedDigest(
          makeBundle("sha256:different", { payloadType: IN_TOTO }),
          DIGEST,
        ),
      (err: unknown) => {
        assert.ok(err instanceof VerifyImageError);
        assert.equal(err.code, "VERIFY_FAILED");
        assert.match(err.message, /does not match/);
        return true;
      },
    );
  });

  it("throws VERIFY_FAILED when subject array is empty", () => {
    const bundle = makeBundle(DIGEST, { payloadType: IN_TOTO, subjects: [] });
    assert.throws(
      () => assertSignedDigest(bundle, DIGEST),
      (err: unknown) => {
        assert.ok(err instanceof VerifyImageError);
        assert.equal(err.code, "VERIFY_FAILED");
        assert.match(err.message, /missing/);
        return true;
      },
    );
  });

  it("throws VERIFY_FAILED when subject has no sha256 field", () => {
    const bundle = makeBundle(DIGEST, {
      payloadType: IN_TOTO,
      subjects: [{ digest: { md5: "notsha256" }, annotations: {} }],
    });
    assert.throws(
      () => assertSignedDigest(bundle, DIGEST),
      (err: unknown) => {
        assert.ok(err instanceof VerifyImageError);
        assert.equal(err.code, "VERIFY_FAILED");
        return true;
      },
    );
  });
});

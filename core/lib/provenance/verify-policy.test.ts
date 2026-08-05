/**
 * Unit tests for core/lib/provenance/verify-policy.ts
 *
 * Run with: vp test run core/lib/provenance/verify-policy.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { buildVerifyOptions } from "./verify-policy.ts";
import type { VerifyBundleOptions } from "./sigstore.ts";

// ── Constants mirrored from verify-policy.ts (for assertion readability) ──────

const EXPECTED_ISSUER = "https://token.actions.githubusercontent.com";
const RELEASE_WORKFLOW = ".github/workflows/docker-publish.yml";
const OID_SOURCE_REPO_DIGEST = "1.3.6.1.4.1.57264.1.13";
const REPO = "dash14/buildcage";

/** Build a sample SAN URI as Fulcio would embed it. */
function makeSAN(ref: string) {
  return `https://github.com/${REPO}/${RELEASE_WORKFLOW}@${ref}`;
}

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

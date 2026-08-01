/**
 * Property-based tests for verify-image.ts helpers.
 *
 * Run with: vp test run core/lib/provenance/verify-image.property.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import fc from "fast-check";

import { buildVerifyOptions } from "./verify-image.ts";

// ---------------------------------------------------------------------------
// buildVerifyOptions
// ---------------------------------------------------------------------------

describe("buildVerifyOptions – properties", () => {
  // SHA pin always produces certificateOIDs; the SAN URI ends with 'v' (accepts any v-tag).
  it("40-char hex SHA always returns certificateOIDs and a compilable SAN regex", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[0-9a-fA-F]{40}$/),
        fc.stringMatching(/^[A-Za-z0-9-]{1,20}\/[A-Za-z0-9-]{1,20}$/),
        (actionRef, actionRepo) => {
          const result = buildVerifyOptions({ actionRef, actionRepo });
          assert.ok(result !== null);
          assert.ok(result.certificateOIDs !== undefined, "SHA ref must set certificateOIDs");
          assert.ok(result.certificateIdentityURI!.endsWith("v"), "SAN URI must accept any v-tag");
          assert.doesNotThrow(() => new RegExp(result.certificateIdentityURI!));
        },
      ),
    );
  });

  // Version tag: even refs containing regex metacharacters must produce a compilable SAN regex.
  // escapeRegex must neutralise chars like '.', '+', '(', ')' in the actionRef portion.
  it("v-prefixed ref always returns no certificateOIDs and a compilable SAN regex", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).map((s) => `v${s}`),
        fc.stringMatching(/^[A-Za-z0-9-]{1,20}\/[A-Za-z0-9-]{1,20}$/),
        (actionRef, actionRepo) => {
          const result = buildVerifyOptions({ actionRef, actionRepo });
          assert.ok(result !== null);
          assert.equal(
            result.certificateOIDs,
            undefined,
            "version tag must not set certificateOIDs",
          );
          assert.doesNotThrow(() => new RegExp(result.certificateIdentityURI!));
        },
      ),
    );
  });

  // Non-SHA, non-v refs (branch names, etc.) are always unverifiable — must return null.
  // Leading 'g' is not a hex char and not 'v', so this always hits the passthrough branch.
  it("non-SHA non-v-prefixed ref always returns null", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 30 }).map((s) => `g${s}`),
        fc.stringMatching(/^[A-Za-z0-9-]{1,20}\/[A-Za-z0-9-]{1,20}$/),
        (actionRef, actionRepo) => {
          assert.equal(buildVerifyOptions({ actionRef, actionRepo }), null);
        },
      ),
    );
  });
});

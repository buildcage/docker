import fc from "fast-check";
import { describe, it, expect } from "vitest";

import { buildVerifyOptions } from "./verify-policy.ts";

// Mirrors RELEASE_REF in verify-policy.ts.
const RELEASE_REF = /^v\d+(\.\d+(\.\d+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?)?)?$/;

describe("buildVerifyOptions: properties", () => {
  it("40-char hex SHA always returns certificateOIDs and a compilable SAN regex", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[0-9a-fA-F]{40}$/),
        fc.stringMatching(/^[A-Za-z0-9-]{1,20}\/[A-Za-z0-9-]{1,20}$/),
        (actionRef, actionRepo) => {
          const result = buildVerifyOptions({ actionRef, actionRepo });
          expect(result).not.toBeNull();
          expect(
            result!.certificateOIDs !== undefined,
            "SHA ref must set certificateOIDs",
          ).toBeTruthy();
          expect(
            result!.certificateIdentityURI!.endsWith("v"),
            "SAN URI must accept any v-tag",
          ).toBeTruthy();
          expect(() => new RegExp(result!.certificateIdentityURI!)).not.toThrow();
        },
      ),
    );
  });

  it("release ref always returns no certificateOIDs and a compilable SAN regex", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(RELEASE_REF),
        fc.stringMatching(/^[A-Za-z0-9-]{1,20}\/[A-Za-z0-9-]{1,20}$/),
        (actionRef, actionRepo) => {
          const result = buildVerifyOptions({ actionRef, actionRepo });
          expect(result).not.toBeNull();
          expect(result!.certificateOIDs, "version tag must not set certificateOIDs").toBe(
            undefined,
          );
          expect(() => new RegExp(result!.certificateIdentityURI!)).not.toThrow();
        },
      ),
    );
  });

  it("the SAN regex matches the canonical repository whatever case actionRepo uses", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z0-9-]{1,20}\/[A-Za-z0-9-]{1,20}$/),
        fc.array(fc.boolean(), { minLength: 41, maxLength: 41 }),
        (canonical, flips) => {
          const actionRepo = canonical.replace(/./g, (c, i: number) =>
            flips[i] ? c.toUpperCase() : c.toLowerCase(),
          );
          const result = buildVerifyOptions({ actionRef: "v1.0.0", actionRepo });
          const san = `https://github.com/${canonical}/.github/workflows/docker-publish.yml@refs/tags/v1.0.0`;
          expect(new RegExp(result!.certificateIdentityURI!).test(san)).toBe(true);
        },
      ),
    );
  });

  it("v-prefixed ref outside the release grammar always returns null", () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 1 })
          .map((s) => `v${s}`)
          .filter((ref) => !RELEASE_REF.test(ref)),
        fc.stringMatching(/^[A-Za-z0-9-]{1,20}\/[A-Za-z0-9-]{1,20}$/),
        (actionRef, actionRepo) => {
          expect(buildVerifyOptions({ actionRef, actionRepo })).toBe(null);
        },
      ),
    );
  });

  // Leading 'g' is not a hex char and not 'v', so this always hits the passthrough branch.
  it("non-SHA non-v-prefixed ref always returns null", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 30 }).map((s) => `g${s}`),
        fc.stringMatching(/^[A-Za-z0-9-]{1,20}\/[A-Za-z0-9-]{1,20}$/),
        (actionRef, actionRepo) => {
          expect(buildVerifyOptions({ actionRef, actionRepo })).toBe(null);
        },
      ),
    );
  });
});

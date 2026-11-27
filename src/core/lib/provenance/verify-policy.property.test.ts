import fc from "fast-check";
import { describe, it, expect } from "vitest";

import { VerifyImageError } from "./errors.ts";
import { buildVerifyOptions, releaseTarget } from "./verify-policy.ts";

// Mirror the grammars in verify-policy.ts.
const RELEASE_REF = /^v\d+(\.\d+(\.\d+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?)?)?$/;
const RELEASE_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$/;

const repo = fc.stringMatching(/^[A-Za-z0-9-]{1,20}\/[A-Za-z0-9-]{1,20}$/);
const version = fc.stringMatching(RELEASE_VERSION).filter((v) => v.length < 60);

describe("releaseTarget: properties", () => {
  it("a 40-char hex SHA always pins its own commit, lowercased", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[0-9a-fA-F]{40}$/), version, (actionRef, actionVersion) => {
        expect(releaseTarget({ actionRef, actionVersion })).toEqual({
          kind: "commit",
          commit: actionRef.toLowerCase(),
        });
      }),
    );
  });

  it("a release ref either selects this version's tag or fails, never returns null", () => {
    fc.assert(
      fc.property(fc.stringMatching(RELEASE_REF), version, (actionRef, actionVersion) => {
        try {
          expect(releaseTarget({ actionRef, actionVersion })?.kind).toBe("tag");
        } catch (err) {
          expect(err).toBeInstanceOf(VerifyImageError);
        }
      }),
    );
  });

  it("a ref outside the release grammar always returns null", () => {
    fc.assert(
      fc.property(
        fc
          .string({ maxLength: 30 })
          .filter((ref) => !RELEASE_REF.test(ref) && !/^[0-9a-fA-F]{40}$/.test(ref)),
        version,
        (actionRef, actionVersion) => {
          expect(releaseTarget({ actionRef, actionVersion })).toBe(null);
        },
      ),
    );
  });
});

describe("buildVerifyOptions: properties", () => {
  it("the SAN regex compiles and matches this version's tag in the canonical repository", () => {
    fc.assert(
      fc.property(
        repo,
        fc.array(fc.boolean(), { minLength: 41, maxLength: 41 }),
        version,
        (canonical, flips, actionVersion) => {
          const actionRepo = canonical.replace(/./g, (c, i: number) =>
            flips[i] ? c.toUpperCase() : c.toLowerCase(),
          );
          const result = buildVerifyOptions({ actionRepo, actionVersion, commit: "a".repeat(40) });
          const san = `https://github.com/${canonical}/.github/workflows/docker-publish.yml@refs/tags/v${actionVersion}`;
          expect(new RegExp(result.certificateIdentityURI!).test(san)).toBe(true);
          expect(new RegExp(result.certificateIdentityURI!).test(`${san}.1`)).toBe(false);
        },
      ),
    );
  });
});

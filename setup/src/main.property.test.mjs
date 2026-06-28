/**
 * Property-based tests for setup/main.mjs and its helpers.
 *
 * Run with: node --test setup/src/main.property.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { imageTagFromRef } from "./lib/verify-image.mjs";
import { buildACLRules, resolveBuildcageImageRef } from "./main.mjs";

// ---------------------------------------------------------------------------
// imageTagFromRef
// ---------------------------------------------------------------------------

describe("imageTagFromRef – properties", () => {
  it("40-char hex SHA always produces sha-<lowercase sha>", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[0-9a-fA-F]{40}$/),
        (sha) => {
          assert.equal(imageTagFromRef(sha), `sha-${sha.toLowerCase()}`);
        },
      ),
    );
  });

  it("v-prefixed ref always strips the leading v", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).map((s) => `v${s}`),
        (ref) => {
          assert.equal(imageTagFromRef(ref), ref.slice(1));
        },
      ),
    );
  });

  // Leading 'g' is not a hex char and not 'v', so this always hits the passthrough branch.
  it("non-SHA non-v-prefixed ref always passes through unchanged", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 50 }).map((s) => `g${s}`),
        (ref) => {
          assert.equal(imageTagFromRef(ref), ref);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// buildACLRules
// ---------------------------------------------------------------------------

describe("buildACLRules – properties", () => {
  it("empty / whitespace-only inputs always return empty arrays", () => {
    const blank = fc.oneof(
      fc.constant(""),
      fc.constant(undefined),
      fc.constant("   "),
      fc.constant("\t\n"),
    );
    fc.assert(
      fc.property(blank, blank, blank, (h, p, i) => {
        const result = buildACLRules({
          httpsRulesInput: h,
          httpRulesInput: p,
          ipRulesInput: i,
        });
        assert.deepEqual(result.httpsRules, []);
        assert.deepEqual(result.httpRules, []);
        assert.deepEqual(result.ipRules, []);
      }),
    );
  });

  it("valid host:port rules produce an array matching the input token count", () => {
    const validRule = fc
      .tuple(
        fc.stringMatching(/^[a-z][a-z0-9-]{0,10}\.[a-z]{2,4}$/),
        fc.integer({ min: 80, max: 65535 }),
      )
      .map(([host, port]) => `${host}:${port}`);

    fc.assert(
      fc.property(fc.array(validRule, { minLength: 0, maxLength: 5 }), (rules) => {
        const result = buildACLRules({
          httpsRulesInput: rules.join(" "),
          httpRulesInput: "",
          ipRulesInput: "",
        });
        assert.equal(result.httpsRules.length, rules.length);
      }),
    );
  });

  // '~'-prefixed tokens are treated as raw regexes and bypass host:port validation.
  it("any token without a colon and without ~ prefix always throws", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[^\s:~]{1,30}$/),
        (token) => {
          assert.throws(
            () =>
              buildACLRules({
                httpsRulesInput: token,
                httpRulesInput: "",
                ipRulesInput: "",
              }),
            (err) => {
              assert.ok(err instanceof Error);
              return true;
            },
          );
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// resolveBuildcageImageRef
// ---------------------------------------------------------------------------

describe("resolveBuildcageImageRef – properties", () => {
  it("with digest: repository part is always lowercased regardless of actionRepository casing", () => {
    const digest = fc.stringMatching(/^sha256:[0-9a-f]{64}$/);
    const repoName = fc
      .tuple(
        fc.stringMatching(/^[A-Za-z0-9-]{1,20}$/),
        fc.stringMatching(/^[A-Za-z0-9-]{1,20}$/),
      )
      .map(([owner, repo]) => `${owner}/${repo}`);

    fc.assert(
      fc.property(repoName, digest, (actionRepository, imageDigest) => {
        const result = resolveBuildcageImageRef({
          imageDigest,
          actionRepository,
          actionRef: "v1.0.0",
        });
        const [repoPart] = result.split("@");
        assert.equal(repoPart, `ghcr.io/${actionRepository.toLowerCase()}`);
      }),
    );
  });
});

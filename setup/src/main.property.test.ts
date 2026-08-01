/**
 * Property-based tests for setup/main.ts and its helpers.
 *
 * Run with: node --test setup/src/main.property.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { imageTagFromRef } from "../../core/lib/provenance/verify-image.ts";
import { resolveBuildcageImageRef } from "../../core/lib/provenance/image-ref.ts";
import { buildACLRules, resolveProxyEngine } from "./main.ts";

// ---------------------------------------------------------------------------
// imageTagFromRef
// ---------------------------------------------------------------------------

// Only the `explicit` engine appends a suffix; `transparent` (the default)
// publishes the plain tag, matching the pre-multi-engine tagging scheme.
const suffixFor = (engine: string) => (engine === "explicit" ? "-explicit" : "");

describe("imageTagFromRef – properties", () => {
  it("40-char hex SHA always produces sha-<lowercase sha>, suffixed only for explicit", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[0-9a-fA-F]{40}$/),
        fc.constantFrom("transparent", "explicit"),
        (sha, engine) => {
          assert.equal(
            imageTagFromRef(sha, engine),
            `sha-${sha.toLowerCase()}${suffixFor(engine)}`,
          );
        },
      ),
    );
  });

  it("v-prefixed ref always strips the leading v, suffixed only for explicit", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).map((s) => `v${s}`),
        fc.constantFrom("transparent", "explicit"),
        (ref, engine) => {
          assert.equal(imageTagFromRef(ref, engine), `${ref.slice(1)}${suffixFor(engine)}`);
        },
      ),
    );
  });

  // Leading 'g' is not a hex char and not 'v', so this always hits the passthrough branch.
  it("non-SHA non-v-prefixed ref always passes through unchanged, suffixed only for explicit", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 50 }).map((s) => `g${s}`),
        fc.constantFrom("transparent", "explicit"),
        (ref, engine) => {
          assert.equal(imageTagFromRef(ref, engine), `${ref}${suffixFor(engine)}`);
        },
      ),
    );
  });

  it("defaults to no suffix (transparent) when no engine is given", () => {
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
// resolveProxyEngine
// ---------------------------------------------------------------------------

describe("resolveProxyEngine – properties", () => {
  it("always returns one of the two literal engine names, or throws", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 20 }), (input) => {
        let result;
        try {
          result = resolveProxyEngine(input);
        } catch {
          return; // throwing is an acceptable outcome for invalid input
        }
        assert.ok(result === "transparent" || result === "explicit");
      }),
    );
  });

  it("is idempotent for its own valid outputs", () => {
    fc.assert(
      fc.property(fc.constantFrom("transparent", "explicit"), (engine) => {
        assert.equal(resolveProxyEngine(resolveProxyEngine(engine)), engine);
      }),
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
      fc.property(fc.stringMatching(/^[^\s:~]{1,30}$/), (token) => {
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
      }),
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
      .tuple(fc.stringMatching(/^[A-Za-z0-9-]{1,20}$/), fc.stringMatching(/^[A-Za-z0-9-]{1,20}$/))
      .map(([owner, repo]) => `${owner}/${repo}`);

    fc.assert(
      fc.property(repoName, digest, (actionRepository, imageDigest) => {
        const result = resolveBuildcageImageRef({
          imageDigest,
          actionRepository,
        });
        const [repoPart] = result.split("@");
        assert.equal(repoPart, `ghcr.io/${actionRepository.toLowerCase()}`);
      }),
    );
  });
});

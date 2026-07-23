/**
 * Property-based tests for run/main.js and its helpers.
 *
 * Run with: node --test run/src/main.property.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { buildACLRules } from "./main.ts";

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
  it("any token without a colon and without ~ prefix always throws SandboxError", () => {
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
            assert.equal((err as Error & { code?: string }).code, "INVALID_RULES");
            return true;
          },
        );
      }),
    );
  });
});

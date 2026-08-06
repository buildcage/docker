/**
 * Property-based tests for run/main.ts and its helpers.
 *
 * Run with: vp test run run/src/main.property.test.ts
 */
import { describe, it, expect } from "vitest";
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
        expect(result.httpsRules).toStrictEqual([]);
        expect(result.httpRules).toStrictEqual([]);
        expect(result.ipRules).toStrictEqual([]);
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
        expect(result.httpsRules.length).toBe(rules.length);
      }),
    );
  });

  // '~'-prefixed tokens are treated as raw regexes and bypass host:port validation.
  it("any token without a colon and without ~ prefix always throws SandboxError", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[^\s:~]{1,30}$/), (token) => {
        expect(() => {
          try {
            buildACLRules({
              httpsRulesInput: token,
              httpRulesInput: "",
              ipRulesInput: "",
            });
          } catch (err) {
            expect(err).toBeInstanceOf(Error);
            expect((err as Error & { code?: string }).code).toBe("INVALID_RULES");
            throw err;
          }
        }).toThrow();
      }),
    );
  });
});

/**
 * Property-based tests for core/lib/acl/wildcard-rules.ts.
 *
 * Run with: vp test run core/lib/acl/wildcard-rules.property.test.ts
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { convertRule, buildRules, parseAndValidateRules } from "./wildcard-rules.ts";

// ---------------------------------------------------------------------------
// convertRule / wildcardToRegex
// ---------------------------------------------------------------------------

describe("convertRule – properties", () => {
  // For a plain domain (no wildcards, no regex metacharacters), the generated
  // regex must match the original pattern and must NOT match a subdomain prefix.
  it("exact pattern round-trips: regex matches original and rejects subdomain prefix", () => {
    const simplePattern = fc
      .tuple(
        fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/),
        fc.stringMatching(/^[a-z]{2,4}$/),
        fc.integer({ min: 1, max: 65535 }),
      )
      .map(([label, tld, port]) => `${label}.${tld}:${port}`);

    fc.assert(
      fc.property(simplePattern, (pattern) => {
        const regex = new RegExp(convertRule(pattern));
        expect(regex.test(pattern), "regex must match original pattern").toBeTruthy();
        expect(
          !regex.test(`sub.${pattern}`),
          "regex must not match with extra subdomain prefix",
        ).toBeTruthy();
      }),
    );
  });

  // Domain labels may contain regex metacharacters in practice (e.g. from unusual
  // hostnames). escapeRegex must neutralise them so the result always compiles.
  it("patterns with regex metacharacters in the domain always produce a compilable regex", () => {
    const metaChar = fc.constantFrom(".", "+", "^", "$", "(", ")", "[", "]", "{", "}", "|", "\\");
    const patternWithMeta = fc
      .tuple(
        fc.stringMatching(/^[a-z]{1,5}$/),
        metaChar,
        fc.stringMatching(/^[a-z]{1,5}$/),
        fc.integer({ min: 1, max: 65535 }),
      )
      .map(([prefix, meta, suffix, port]) => `${prefix}${meta}${suffix}.com:${port}`);

    fc.assert(
      fc.property(patternWithMeta, (pattern) => {
        expect(() => new RegExp(convertRule(pattern))).not.toThrow();
      }),
    );
  });

  // A domain label that contains '*' but is not exactly '*' or '**' is always invalid.
  // Labels starting with '~' are excluded: they make the full pattern a raw-regex rule,
  // which bypasses wildcard validation (same escape hatch as in buildACLRules).
  it("label with * mixed with other characters always throws", () => {
    const mixedWildcardLabel = fc
      .string({ minLength: 1, maxLength: 8 })
      .filter(
        (s) => s.includes("*") && s !== "*" && s !== "**" && !s.startsWith("~") && !s.includes("."),
      );

    fc.assert(
      fc.property(mixedWildcardLabel, (label) => {
        expect(() => convertRule(`${label}.com:443`)).toThrow();
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// buildRules
// ---------------------------------------------------------------------------

describe("buildRules – properties", () => {
  // N valid rules joined with any whitespace separator always produce length N.
  it("N valid rules joined by any whitespace always return an array of length N", () => {
    const validRule = fc
      .tuple(
        fc.stringMatching(/^[a-z][a-z0-9]{0,8}\.[a-z]{2,4}$/),
        fc.integer({ min: 1, max: 65535 }),
      )
      .map(([domain, port]) => `${domain}:${port}`);

    const whitespace = fc.constantFrom(" ", "\t", "\n", "  ", " \t ");

    fc.assert(
      fc.property(fc.array(validRule, { minLength: 0, maxLength: 5 }), whitespace, (rules, sep) => {
        const result = buildRules(rules.join(sep));
        expect(result.length).toBe(rules.length);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// parseAndValidateRules
// ---------------------------------------------------------------------------

describe("parseAndValidateRules – properties", () => {
  it("returns the same tokens buildRules derives its length from, unconverted", () => {
    const validRule = fc
      .tuple(
        fc.stringMatching(/^[a-z][a-z0-9]{0,8}\.[a-z]{2,4}$/),
        fc.integer({ min: 1, max: 65535 }),
      )
      .map(([domain, port]) => `${domain}:${port}`);

    fc.assert(
      fc.property(fc.array(validRule, { minLength: 0, maxLength: 5 }), (rules) => {
        const input = rules.join(" ");
        expect(parseAndValidateRules(input)).toStrictEqual(rules);
        expect(parseAndValidateRules(input).length).toBe(buildRules(input).length);
      }),
    );
  });

  it("returns an empty array for empty/undefined input", () => {
    expect(parseAndValidateRules(undefined)).toStrictEqual([]);
    expect(parseAndValidateRules("")).toStrictEqual([]);
  });

  it("throws on invalid syntax, matching buildRules' own validation", () => {
    expect(() => parseAndValidateRules("no-port-specified")).toThrow();
    expect(() => buildRules("no-port-specified")).toThrow();
  });
});

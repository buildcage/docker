import fc from "fast-check";
/**
 * Property-based tests for core/lib/acl/wildcard-rules.ts.
 */
import { describe, it, expect } from "vitest";

import { convertRule, parseAndValidateRules } from "./wildcard-rules.ts";

describe("convertRule: properties", () => {
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

  // No hostname carries one, so a rule that does could only ever match nothing.
  // The dot is left out: it is the label separator.
  it("patterns with regex metacharacters in the domain always throw", () => {
    const metaChar = fc.constantFrom("+", "^", "$", "(", ")", "[", "]", "{", "}", "|", "\\");
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
        expect(() => convertRule(pattern)).toThrow();
      }),
    );
  });

  // Labels starting with '~' are excluded: they make the full pattern a raw-regex rule,
  // which bypasses wildcard validation.
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

describe("parseAndValidateRules: whitespace", () => {
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
        const result = parseAndValidateRules(rules.join(sep));
        expect(result.length).toBe(rules.length);
      }),
    );
  });
});

describe("parseAndValidateRules: properties", () => {
  it("returns the tokens as written, unconverted", () => {
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
      }),
    );
  });

  it("returns an empty array for empty/undefined input", () => {
    expect(parseAndValidateRules(undefined)).toStrictEqual([]);
    expect(parseAndValidateRules("")).toStrictEqual([]);
  });

  it("throws on invalid syntax", () => {
    expect(() => parseAndValidateRules("no-port-specified")).toThrow();
  });
});

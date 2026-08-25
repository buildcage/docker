import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import {
  domainToRegexPartial,
  pathToRegexPartial,
  wildcardToRegexPartial,
} from "./partial-wildcard.ts";

function matches(pattern: string, name: string): boolean {
  return new RegExp(`^${domainToRegexPartial(pattern)}$`).test(name);
}

// ---------------------------------------------------------------------------
// The point of this compiler: a wildcard may sit among literal text in a
// label. The shared compiler rejects that, which would force an author to
// widen the pattern to a whole label, and the resolver's scope is generated
// from these patterns.
// ---------------------------------------------------------------------------
describe("wildcard inside a label", () => {
  it("accepts a trailing wildcard", () => {
    expect(matches("abc*.amazonaws.com", "abc123.amazonaws.com")).toBe(true);
    expect(matches("abc*.amazonaws.com", "xyz123.amazonaws.com")).toBe(false);
  });

  it("keeps the wildcard inside its own label", () => {
    expect(matches("abc*.amazonaws.com", "abc1.deep.amazonaws.com")).toBe(false);
  });

  it("accepts a leading wildcard", () => {
    expect(matches("*-cdn.example.com", "assets-cdn.example.com")).toBe(true);
    expect(matches("*-cdn.example.com", "assets.example.com")).toBe(false);
  });

  it("accepts a wildcard between literals", () => {
    expect(matches("a*z.example.com", "abcz.example.com")).toBe(true);
    expect(matches("a*z.example.com", "abcy.example.com")).toBe(false);
  });

  it("requires at least one character, matching the shared `*`", () => {
    expect(matches("abc*.example.com", "abc.example.com")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Everything the shared compiler already meant keeps meaning it.
// ---------------------------------------------------------------------------
describe("unchanged vocabulary", () => {
  it("* alone is one label", () => {
    expect(matches("*.example.com", "a.example.com")).toBe(true);
    expect(matches("*.example.com", "a.b.example.com")).toBe(false);
  });

  it("** crosses labels", () => {
    expect(matches("**.example.com", "a.b.example.com")).toBe(true);
  });

  it("** among literals crosses labels too", () => {
    expect(matches("abc**.example.com", "abc1.deep.example.com")).toBe(true);
  });

  it("? is a single character within a label", () => {
    expect(matches("a?c.example.com", "abc.example.com")).toBe(true);
    expect(matches("a?c.example.com", "abbc.example.com")).toBe(false);
    expect(matches("a?c.example.com", "a.c.example.com")).toBe(false);
  });

  it("escapes regex metacharacters in literal text", () => {
    expect(domainToRegexPartial("a+b.example.com")).toBe("a\\+b\\.example\\.com");
    expect(matches("a+b.example.com", "aXb.example.com")).toBe(false);
  });

  it("rejects an empty label", () => {
    expect(() => domainToRegexPartial("a..b")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// wildcardToRegexPartial keeps the shape callers split on
// ---------------------------------------------------------------------------
describe("wildcardToRegexPartial", () => {
  it("appends the port after the last colon", () => {
    expect(wildcardToRegexPartial("abc*.example.com:443")).toBe("abc[^.]+\\.example\\.com:443");
  });

  it("compiles a wildcard port", () => {
    expect(wildcardToRegexPartial("a.example.com:*")).toBe("a\\.example\\.com:\\d+");
  });

  it("rejects a pattern with no port", () => {
    expect(() => wildcardToRegexPartial("a.example.com")).toThrow();
  });

  it("rejects a non-numeric port", () => {
    expect(() => wildcardToRegexPartial("a.example.com:80x")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Paths use the same grammar, so a rule can narrow to part of a segment for
// the same reason a domain rule can narrow to part of a label.
// ---------------------------------------------------------------------------
describe("paths", () => {
  const p = (pattern: string, path: string) =>
    new RegExp(`^${pathToRegexPartial(pattern)}$`).test(path);

  it("accepts a wildcard among literal text in a segment", () => {
    expect(p("/pkg-*/x", "/pkg-1/x")).toBe(true);
    expect(p("/pkg-*/x", "/other/x")).toBe(false);
  });

  it("keeps a partial wildcard inside its own segment", () => {
    expect(p("/pkg-*/x", "/pkg-1/y/x")).toBe(false);
  });

  it("* alone is one segment", () => {
    expect(p("/pkg/*", "/pkg/a")).toBe(true);
    expect(p("/pkg/*", "/pkg/a/b")).toBe(false);
  });

  it("** crosses separators and may be empty", () => {
    expect(p("/pkg/**", "/pkg/a/b")).toBe(true);
    expect(p("/pkg/**", "/pkg/")).toBe(true);
  });

  it("? is a single character", () => {
    expect(p("/v?/x", "/v1/x")).toBe(true);
    expect(p("/v?/x", "/v10/x")).toBe(false);
  });

  it("escapes regex metacharacters", () => {
    expect(pathToRegexPartial("/a.b/c")).toBe("/a\\.b/c");
  });

  it("returns an empty fragment for an empty path", () => {
    expect(pathToRegexPartial("")).toBe("");
  });
});

reportResults();

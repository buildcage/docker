import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import {
  anchorRawRegex,
  checkRawRegexHalf,
  domainToRegexPartial,
  endsAnchored,
  pathToRegexPartial,
  splitDomainFromPortPattern,
  splitRawRegexHost,
  wildcardToRegexPartial,
} from "./partial-wildcard.ts";

function matches(pattern: string, name: string): boolean {
  return new RegExp(`^${domainToRegexPartial(pattern)}$`).test(name);
}

// ---------------------------------------------------------------------------
// The point of this compiler: a wildcard may sit among literal text in a
// label. The shared compiler rejects that, forcing an author to widen the
// pattern to a whole label, which widens the resolver's scope with it.
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
// Every wildcard the shared compiler accepts keeps the same meaning here.
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

  it("rejects a character no hostname can", () => {
    expect(() => domainToRegexPartial("a+b.example.com")).toThrow(/no hostname can/);
    expect(() => domainToRegexPartial("user@example.com")).toThrow(/no hostname can/);
  });

  it("rejects an internationalized name, pointing at its punycode form", () => {
    expect(() => domainToRegexPartial("münchen.de")).toThrow(/punycode/);
  });

  it("accepts the characters a hostname holds, underscore included", () => {
    expect(domainToRegexPartial("_acme-challenge.Ex4mple.com")).toBe(
      "_acme-challenge\\.Ex4mple\\.com",
    );
  });

  it("rejects an empty label", () => {
    expect(() => domainToRegexPartial("a..b")).toThrow(/empty label/);
    expect(() => domainToRegexPartial(".example.com")).toThrow(/empty label/);
    expect(() => domainToRegexPartial("example.com.")).toThrow(/empty label/);
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

  it("rejects a port that is missing or non-numeric", () => {
    expect(() => wildcardToRegexPartial("a.example.com")).toThrow();
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

describe("splitRawRegexHost host-half compilation", () => {
  // The whole expression compiles, but the split at the port separator cuts a
  // group open, so the host half alone does not.
  it("refuses a rule whose host half does not compile on its own", () => {
    expect(() => splitRawRegexHost("~(a\\.com:443)")).toThrow(/does not compile on its own/);
  });

  it("splits a non-capturing group at the port, not at its own colon", () => {
    expect(splitRawRegexHost("~(?:a|b)\\.example\\.com:443")).toStrictEqual({
      host: "(?:a|b)\\.example\\.com",
    });
  });
});

describe("checkRawRegexHalf: resolver regex syntax", () => {
  const check = (text: string, hostHalf: boolean) =>
    checkRawRegexHalf(text, "host half", `~${text}`, hostHalf);

  it("refuses lookaround and backreferences in a host half, which RE2 lacks", () => {
    for (const text of [
      "(?!evil)[a-z]+\\.com",
      "(?=a)[a-z]+\\.com",
      "(?<=a)b\\.com",
      "(?<!a)b\\.com",
      "(a)\\1\\.com",
    ]) {
      expect(() => check(text, true)).toThrow(/RE2/);
    }
  });

  it("leaves the same text alone when it is escaped or inside a character class", () => {
    expect(() => check("\\(?!a\\.com", true)).not.toThrow();
    expect(() => check("a\\\\1\\.com", true)).not.toThrow();
    expect(() => check("[(?!]a\\.com", true)).not.toThrow();
    expect(() => check("(?<n>a)\\.com", true)).not.toThrow();
  });

  it("does not apply outside a host half, which only the proxy matches", () => {
    expect(() => check("/(?!admin).*", false)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// The pieces a `~` rule is built from. Each is used by several modules
// (url-rules, wildcard-rules, haproxy-rules), whose own tests
// assert the output they produce; these fix what all of that rests on.
// ---------------------------------------------------------------------------
describe("checkRawRegexHalf", () => {
  const check = (text: string, hostHalf: boolean) =>
    checkRawRegexHalf(text, "expression", `~${text}`, hostHalf);

  it("refuses a top-level alternation, which anchors would bind to one branch of", () => {
    // `^a|b$` anchors a at the front and b at the back, leaving each branch
    // open at its other end.
    expect(() => check("a\\.com:443|b\\.com:443", false)).toThrow(/top-level "\|"/);
    expect(() => check("a\\.com|b\\.com:443", false)).toThrow(/top-level "\|"/);
  });

  it("refuses an escape PCRE2 may read differently from JavaScript", () => {
    for (const text of [
      "x\\.com:443\\Q[\\E|:443]?",
      "x\\.com:443\\c[|:443]?",
      "x\\x5b\\.com:443",
      "x\\K\\.com:443",
      "(?<n>a)\\k<n>\\.com:443",
      "/(a)\\12",
      "/a\\0",
    ]) {
      expect(() => check(text, false)).toThrow(/uses "\\([A-Za-z]|\d+)"/);
    }
  });

  it("keeps the escapes both engines read alike, and any escaped punctuation", () => {
    for (const text of [
      "\\d+\\.com:443",
      "a\\s?\\b\\-b\\.com:443",
      "a\\\\Q\\.com:443",
      "/(a)\\1",
    ]) {
      expect(() => check(text, false)).not.toThrow();
    }
  });

  it("leaves an alternation inside a group or a character class alone", () => {
    expect(() => check("a\\.com:(443|8443)", false)).not.toThrow();
    expect(() => check("a\\.com:[4|8]443", false)).not.toThrow();
  });

  it("reads past an escaped delimiter rather than tracking it as one", () => {
    // `\(` and `\[` are literals, so neither opens anything the `|` after it
    // could be sitting inside.
    expect(() => check("a\\(b|c", false)).toThrow(/top-level "\|"/);
    expect(() => check("a\\[b|c", false)).toThrow(/top-level "\|"/);
  });

  it("refuses a literal bracket in the host half, an IPv6 authority above all", () => {
    // One there means the ":" the rule was split at was not its port separator.
    expect(() => check("\\[::1\\]", true)).toThrow(/no hostname can/);
  });

  it("keeps a character class, whose own `[` is not escaped", () => {
    expect(() => check("web[0-9]\\.example\\.com", true)).not.toThrow();
  });

  it("looks for that bracket in the host half only", () => {
    expect(() => check("\\[::1\\]", false)).not.toThrow();
  });

  it("refuses what would break out of the resolver's quoted expression", () => {
    // The host half lands in a single-quoted CEL literal, and `{$` and `{%`
    // are Corefile environment substitution.
    expect(() => check("a'b\\.com", true)).toThrow(/cannot quote/);
    expect(() => check("a`b\\.com", true)).toThrow(/cannot quote/);
    expect(() => check("a{$HOME}\\.com", true)).toThrow(/cannot quote/);
    expect(() => check("a{%HOME%}\\.com", true)).toThrow(/cannot quote/);
  });

  it("keeps a quantifier brace, which is not substitution", () => {
    expect(() => check("a{2}\\.com", true)).not.toThrow();
  });

  it("looks for those characters in the host half only", () => {
    expect(() => check("/a'b", false)).not.toThrow();
  });

  it("refuses a class PCRE2 would end somewhere other than setup does", () => {
    // Setup closes `[]` at once and so finds the "|" inside a group; PCRE2
    // reads that `]` as a literal and the "|" at the top level.
    for (const text of ["[](]a|.*[])]?:443", "[^](]a|.*[])]?:443", "[[:alpha:]]+\\.com:443"]) {
      expect(() => check(text, false)).toThrow(/character class/);
    }
    expect(() => check("[[.a.]]\\.com:443", false)).toThrow(/class syntax "\[\.a\.\]"/);
    expect(() => check("[[=a=]]\\.com:443", false)).toThrow(/class syntax "\[=a=\]"/);
  });

  it("refuses a POSIX class outside a class, which PCRE2 refuses to compile", () => {
    for (const text of ["[:a:]\\.com:443", "[.a.]\\.com:443", "[:a\\]:]\\.com:443"]) {
      expect(() => check(text, false)).toThrow(/character class/);
    }
  });

  it("keeps a bracket PCRE2 does not take for a POSIX class", () => {
    for (const text of [
      "[^.]+\\.com:443",
      "[.-]\\.com:443",
      "[a[:]\\.com:443",
      "[:a]:\\d+",
      "[:[:]\\.com:443",
    ]) {
      expect(() => check(text, false)).not.toThrow();
    }
  });

  it("keeps an escaped bracket in a class, and a literal `[` that opens nothing", () => {
    for (const text of [
      "[\\]a]\\.com:443",
      "[\\[:]\\.com:443",
      "[a[]\\.com:443",
      "a\\[:\\.com:443",
    ]) {
      expect(() => check(text, false)).not.toThrow();
    }
  });

  it("refuses a backreference to a group the text does not have", () => {
    expect(() => check("/a\\1", false)).toThrow(/uses "\\1" but has 0 capturing groups/);
    expect(() => check("/(a)(?:b)\\2", false)).toThrow(/but has 1 capturing group$/);
    expect(() => check("/(?<n>a)(b)\\2", false)).not.toThrow();
    expect(() => check("/(?<=a)(b)\\1", false)).not.toThrow();
  });

  it("reads a digit escape in a class as the octal both engines take it for", () => {
    expect(() => check("/[\\1]", false)).not.toThrow();
  });

  it("refuses `\\B` in a class, which PCRE2 does not accept", () => {
    expect(() => check("/[\\B]", false)).toThrow(/"\\B" in a character class/);
    expect(() => check("/[\\b]\\B", false)).not.toThrow();
  });
});

describe("endsAnchored", () => {
  it("is false for an expression that does not end in `$` at all", () => {
    expect(endsAnchored("a\\.com:443")).toBe(false);
  });

  it("is true for a bare trailing `$`", () => {
    expect(endsAnchored("a\\.com:443$")).toBe(true);
  });

  // The `$` is an anchor only when the backslashes before it pair off: `\$` is
  // an escaped dollar, `\\$` is an escaped backslash followed by the anchor.
  it("reads an escaped dollar as the literal it is", () => {
    expect(endsAnchored("a\\.com:443\\$")).toBe(false);
    expect(endsAnchored("a\\.com:443\\\\\\$")).toBe(false);
  });

  it("reads the anchor behind an escaped backslash as the anchor it is", () => {
    expect(endsAnchored("a\\.com:443\\\\$")).toBe(true);
    expect(endsAnchored("a\\.com:443\\\\\\\\$")).toBe(true);
  });
});

describe("anchorRawRegex", () => {
  // Unanchored, `example\.com:443` would also admit `evil-example.com:4430`.
  it("closes an expression the author left open at both ends", () => {
    expect(anchorRawRegex("example\\.com:443")).toBe("^example\\.com:443$");
  });

  it("adds only the anchor that is missing", () => {
    expect(anchorRawRegex("^example\\.com:443")).toBe("^example\\.com:443$");
    expect(anchorRawRegex("example\\.com:443$")).toBe("^example\\.com:443$");
  });

  it("leaves an already-anchored expression as it stands", () => {
    expect(anchorRawRegex("^example\\.com:443$")).toBe("^example\\.com:443$");
  });

  it("anchors past a trailing dollar that is a literal rather than an anchor", () => {
    expect(anchorRawRegex("example\\.com:443\\$")).toBe("^example\\.com:443\\$$");
  });
});

describe("splitDomainFromPortPattern", () => {
  it("splits at a bare colon", () => {
    expect(splitDomainFromPortPattern("^a\\.com:443")).toStrictEqual({
      domain: "^a\\.com",
      portPattern: ":443",
    });
  });

  // Splitting at the last colon instead would cut the group open, leaving a
  // dangling `(` in the host half and a dangling `)` in the port half.
  it("splits at the `(` of a group opening on the colon, keeping both halves balanced", () => {
    expect(splitDomainFromPortPattern("^a\\.com(:8443)?")).toStrictEqual({
      domain: "^a\\.com",
      portPattern: "(:8443)?",
    });
    expect(splitDomainFromPortPattern("^a\\.com(:443|:8443)")).toStrictEqual({
      domain: "^a\\.com",
      portPattern: "(:443|:8443)",
    });
  });

  it("splits at the first port pattern, not at the last colon in the fragment", () => {
    expect(splitDomainFromPortPattern("^a\\.com:44[0-9]:x")).toStrictEqual({
      domain: "^a\\.com",
      portPattern: ":44[0-9]:x",
    });
  });

  it("skips the colon of a group's own syntax", () => {
    expect(splitDomainFromPortPattern("(?:a|b)\\.com:443")).toStrictEqual({
      domain: "(?:a|b)\\.com",
      portPattern: ":443",
    });
    expect(splitDomainFromPortPattern("(?i:a)\\.com(:443)?")).toStrictEqual({
      domain: "(?i:a)\\.com",
      portPattern: "(:443)?",
    });
    expect(splitDomainFromPortPattern("(?<n>a)\\.com:443")).toStrictEqual({
      domain: "(?<n>a)\\.com",
      portPattern: ":443",
    });
  });

  it("skips a colon that is escaped or inside a character class", () => {
    expect(splitDomainFromPortPattern("a[:x]\\:b\\(:c:443")).toStrictEqual({
      domain: "a[:x]\\:b\\(",
      portPattern: ":c:443",
    });
  });

  it("reports no port pattern when the fragment names none", () => {
    expect(splitDomainFromPortPattern("^a\\.com")).toStrictEqual({
      domain: "^a\\.com",
      portPattern: null,
    });
  });
});

reportResults();

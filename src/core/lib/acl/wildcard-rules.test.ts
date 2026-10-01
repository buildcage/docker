import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import {
  wildcardToRegex,
  convertRule,
  splitRuleTokens,
  parseAndValidateRules,
  completeRulePort,
  parseAndValidateKnownBlockedRules,
  isKnownBlockedUrlRule,
} from "./wildcard-rules.ts";

describe("wildcardToRegex", () => {
  it("exact domain: dots escaped", () => {
    expect(wildcardToRegex("example.com:443")).toBe("example\\.com:443");
  });

  it("single wildcard *", () => {
    expect(wildcardToRegex("*.example.com:443")).toBe("[^.]+\\.example\\.com:443");
  });

  it("double wildcard **", () => {
    expect(wildcardToRegex("**.example.com:443")).toBe(".+\\.example\\.com:443");
  });

  it("question mark ?", () => {
    expect(wildcardToRegex("exampl?.com:443")).toBe("exampl[^.]\\.com:443");
  });

  it("multiple wildcards", () => {
    expect(wildcardToRegex("*.*.example.com:443")).toBe("[^.]+\\.[^.]+\\.example\\.com:443");
  });

  it("rejects mixed * in part", () => {
    expect(() => wildcardToRegex("w*.example.com:443")).toThrow(/Invalid wildcard/);
  });

  it("rejects a character no hostname can", () => {
    expect(() => wildcardToRegex("example+site.com:443")).toThrow(/no hostname can/);
    expect(() => wildcardToRegex("a'b.com:443")).toThrow(/no hostname can/);
  });

  it("rejects an internationalized name, pointing at its punycode form", () => {
    expect(() => wildcardToRegex("münchen.de:443")).toThrow(/punycode/);
    expect(wildcardToRegex("xn--mnchen-3ya.de:443")).toBe("xn--mnchen-3ya\\.de:443");
  });

  it("rejects an empty label, which no host has", () => {
    expect(() => wildcardToRegex(".example.com:443")).toThrow(/empty label/);
    expect(() => wildcardToRegex("example.com.:443")).toThrow(/empty label/);
    expect(() => wildcardToRegex("a..example.com:443")).toThrow(/empty label/);
  });

  it("turns an IPv4 CIDR block into the addresses it covers", () => {
    expect(wildcardToRegex("10.0.0.0/8:443")).toBe("10\\.[0-9]+\\.[0-9]+\\.[0-9]+:443");
    expect(wildcardToRegex("10.1.2.3/32:443")).toBe("10\\.1\\.2\\.3:443");
    expect(wildcardToRegex("0.0.0.0/0:443")).toBe("[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+:443");
    expect(() => wildcardToRegex("example.com/8:443")).toThrow(/no hostname can/);
  });

  it("lists the values of an octet a CIDR prefix only partly fixes", () => {
    expect(wildcardToRegex("192.168.1.9/30:*")).toBe("192\\.168\\.1\\.(?:8|9|10|11):\\d+");
    // Host bits are masked off, as HAProxy's dst does.
    expect(wildcardToRegex("172.31.0.0/12:443")).toBe(
      "172\\.(?:16|17|18|19|20|21|22|23|24|25|26|27|28|29|30|31)\\.[0-9]+\\.[0-9]+:443",
    );
  });

  it("matches a CIDR block against exactly the addresses inside it", () => {
    const re = new RegExp(convertRule("10.20.0.0/14:443"));
    expect(re.test("10.20.0.1:443")).toBe(true);
    expect(re.test("10.23.255.255:443")).toBe(true);
    expect(re.test("10.24.0.1:443")).toBe(false);
    expect(re.test("10.19.255.255:443")).toBe(false);
    expect(re.test("10.20.0.1:444")).toBe(false);
  });

  it("rejects a CIDR block HAProxy would misread or reject", () => {
    expect(() => wildcardToRegex("010.0.0.0/8:443")).toThrow(/Invalid CIDR block/);
    expect(() => wildcardToRegex("10.0.0.0/33:443")).toThrow(/Invalid CIDR block/);
  });

  it("wildcard port *", () => {
    expect(wildcardToRegex("example.com:*")).toBe("example\\.com:\\d+");
  });

  it("rejects a port that is missing, non-numeric or not after the last colon", () => {
    expect(() => wildcardToRegex("example.com")).toThrow(/Invalid pattern/);
    expect(() => wildcardToRegex("example.com:abc")).toThrow(/Invalid pattern/);
    expect(() => wildcardToRegex("example.com:443:extra")).toThrow(/Invalid pattern/);
  });
});

describe("convertRule", () => {
  it("wraps the wildcard conversion in anchors", () => {
    expect(convertRule("*.example.com:8443")).toBe("^[^.]+\\.example\\.com:8443$");
  });

  it("regex rule (~ prefix): returned as-is without ~", () => {
    expect(convertRule("~^custom\\.regex:443$")).toBe("^custom\\.regex:443$");
  });

  it("anchors a regex rule the author left open at either end", () => {
    expect(convertRule("~example\\.com:443")).toBe("^example\\.com:443$");
    expect(convertRule("~^example\\.com:443")).toBe("^example\\.com:443$");
    expect(convertRule("~example\\.com:443$")).toBe("^example\\.com:443$");
  });

  it("refuses a top-level alternation, which anchors cannot bind around", () => {
    expect(() => convertRule("~a\\.com:443|b\\.com:443")).toThrow(/top-level "\|"/);
    expect(() => convertRule("~a\\.com|b\\.com:443")).toThrow(/top-level "\|"/);
  });

  it("refuses an escape that could hide a top-level alternation from the check", () => {
    expect(() => convertRule("~^x\\.good\\.com:443\\Q[\\E|:443]?")).toThrow(/uses "\\Q"/);
  });

  it("refuses an IPv6 authority, whose colons are not the port separator", () => {
    expect(() => convertRule("~^\\[::1\\]:443$")).toThrow(/IPv6/);
  });

  it("refuses a host half the resolver's config cannot quote", () => {
    expect(() => convertRule("~a'b\\.com:443")).toThrow(/cannot quote/);
  });

  it("leaves an alternation inside a group or a class alone", () => {
    expect(convertRule("~a\\.com:(443|8443)")).toBe("^a\\.com:(443|8443)$");
    expect(convertRule("~a\\.com:[4|8]443")).toBe("^a\\.com:[4|8]443$");
  });

  it("treats an escaped dollar as a literal, not as the anchor it looks like", () => {
    expect(convertRule("~a\\.com:443\\$")).toBe("^a\\.com:443\\$$");
    // An escaped backslash before the "$" leaves the "$" itself an anchor.
    expect(convertRule("~a\\.com:443\\\\$")).toBe("^a\\.com:443\\\\$");
  });

  it("rejects invalid regex (~ prefix)", () => {
    expect(() => convertRule("~^(unclosed")).toThrow(/Invalid regex/);
  });

  it("rejects a regex rule (~ prefix) with no port", () => {
    expect(() => convertRule("~^example\\.com$")).toThrow(/a port is always required/);
  });

  it("rejects a regex rule (~ prefix) with no port even without anchors", () => {
    expect(() => convertRule("~example\\.com")).toThrow(/a port is always required/);
  });
});

describe("convertRule: regex behavior", () => {
  it("* matches single-level subdomain only", () => {
    const re = new RegExp(convertRule("*.example.com:443"));
    expect(re.test("sub.example.com:443")).toBeTruthy();
    expect(!re.test("deep.sub.example.com:443")).toBeTruthy();
    expect(!re.test("example.com:443")).toBeTruthy();
  });

  it("** matches multi-level subdomains", () => {
    const re = new RegExp(convertRule("**.example.com:443"));
    expect(re.test("sub.example.com:443")).toBeTruthy();
    expect(re.test("deep.sub.example.com:443")).toBeTruthy();
    expect(!re.test("example.com:443")).toBeTruthy();
  });

  it("? matches exactly one non-dot character", () => {
    const re = new RegExp(convertRule("exampl?.com:443"));
    expect(re.test("example.com:443")).toBeTruthy();
    expect(!re.test("exampl.com:443")).toBeTruthy();
    expect(!re.test("examplee.com:443")).toBeTruthy();
  });

  it("exact domain does not match subdomains", () => {
    const re = new RegExp(convertRule("example.com:443"));
    expect(re.test("example.com:443")).toBeTruthy();
    expect(!re.test("sub.example.com:443")).toBeTruthy();
  });

  it("port mismatch is rejected", () => {
    const re = new RegExp(convertRule("example.com:443"));
    expect(!re.test("example.com:8443")).toBeTruthy();
  });

  it("wildcard port matches any port", () => {
    const re = new RegExp(convertRule("example.com:*"));
    expect(re.test("example.com:443")).toBeTruthy();
    expect(re.test("example.com:8080")).toBeTruthy();
    expect(!re.test("example.com:abc")).toBeTruthy();
  });
});

describe("splitRuleTokens comments", () => {
  it("drops a full-line comment and a blank line", () => {
    expect(
      splitRuleTokens("# npm\nregistry.npmjs.org:443\n\n# internal\napi.example.com:443"),
    ).toStrictEqual(["registry.npmjs.org:443", "api.example.com:443"]);
  });

  it("drops an end-of-line comment, keeping the tokens before it", () => {
    expect(splitRuleTokens("registry.npmjs.org:443  # packages")).toStrictEqual([
      "registry.npmjs.org:443",
    ]);
    // Several tokens can share a line; only the whitespace-preceded # starts the comment.
    expect(splitRuleTokens("a.example.com:443 b.example.com:443 # both")).toStrictEqual([
      "a.example.com:443",
      "b.example.com:443",
    ]);
  });

  it("rejects a # glued to a rule, since one never legitimately appears in a rule", () => {
    // A bare `#` in a host or a ~ regex would otherwise pass as a rule matching
    // a `#` that no host ever carries, so it is reported instead of trimmed.
    expect(() => splitRuleTokens("~^a#b:443$")).toThrow(/Invalid rule/);
    expect(() => splitRuleTokens("example.com#c:443")).toThrow(/never part of a host or URL/);
  });

  it("names the offending token, not the whole line, when others share it", () => {
    expect(() => splitRuleTokens("a.example.com:443 b#c.example.com:443")).toThrow(
      /Invalid rule "b#c\.example\.com:443"/,
    );
  });

  it("treats a comment-only input the same as an empty one", () => {
    expect(splitRuleTokens("# only a comment")).toStrictEqual([]);
    expect(splitRuleTokens("")).toStrictEqual([]);
  });
});

describe("parseAndValidateRules", () => {
  it("returns raw (unconverted) rule tokens", () => {
    expect(parseAndValidateRules("example.com:443 *.foo.com:8443")).toStrictEqual([
      "example.com:443",
      "*.foo.com:8443",
    ]);
    // A YAML block scalar hands the action newlines rather than spaces.
    expect(parseAndValidateRules("example.com:443\n*.foo.com:8443")).toStrictEqual([
      "example.com:443",
      "*.foo.com:8443",
    ]);
  });

  it("validates syntax eagerly, throwing on invalid wildcard rules", () => {
    expect(() => parseAndValidateRules("w*.example.com:443")).toThrow(/Invalid wildcard/);
  });

  it("validates syntax eagerly, throwing on invalid regex rules", () => {
    expect(() => parseAndValidateRules("~^(unclosed")).toThrow(/Invalid regex/);
  });
});

describe("known_blocked_rules port completion", () => {
  it("completes a rule that names no port, so a refused name can be declared", () => {
    expect(completeRulePort("_mongodb._tcp.c0.example.net")).toBe("_mongodb._tcp.c0.example.net:*");
    expect(completeRulePort("telemetry.example.com")).toBe("telemetry.example.com:*");
    expect(completeRulePort("*.example.com")).toBe("*.example.com:*");
  });

  it("leaves a rule that already names a port alone", () => {
    expect(completeRulePort("noisy.example.com:443")).toBe("noisy.example.com:443");
    expect(completeRulePort("noisy.example.com:*")).toBe("noisy.example.com:*");
    expect(completeRulePort("~^a[.]example[.]com:443$")).toBe("~^a[.]example[.]com:443$");
  });

  it("takes a regex rule's closing anchor off, convertRule putting it back", () => {
    expect(completeRulePort("~^_mongodb[.]_tcp[.]c0$")).toBe("~^_mongodb[.]_tcp[.]c0:\\d+");
    expect(convertRule(completeRulePort("~^_mongodb[.]_tcp[.]c0$"))).toBe(
      "^_mongodb[.]_tcp[.]c0:\\d+$",
    );
  });

  it("keeps an escaped dollar, which is a literal rather than an anchor", () => {
    expect(completeRulePort("~^a\\$")).toBe("~^a\\$:\\d+");
  });

  it("treats a missing input the same as an empty one", () => {
    expect(parseAndValidateKnownBlockedRules(undefined)).toStrictEqual([]);
  });

  it("is what parseAndValidateKnownBlockedRules returns, one rule per line", () => {
    expect(parseAndValidateKnownBlockedRules("a.example.com\nb.example.com:443")).toStrictEqual([
      "a.example.com:*",
      "b.example.com:443",
    ]);
  });

  it("reads two host rules crammed onto one line as a malformed URL rule (v4)", () => {
    // Newline-separated now, so a space is a URL rule's method separator; the
    // old whitespace-separated form no longer parses.
    expect(() => parseAndValidateKnownBlockedRules("a.example.com b.example.com:443")).toThrow(
      /Invalid method/,
    );
  });

  it("keeps a URL rule line as written, validating it through the URL compiler", () => {
    expect(
      parseAndValidateKnownBlockedRules(
        "telemetry.example.com\nPOST https://api.example.com/telemetry",
      ),
    ).toStrictEqual(["telemetry.example.com:*", "POST https://api.example.com/telemetry"]);
  });

  it("rejects a malformed URL rule line", () => {
    expect(() => parseAndValidateKnownBlockedRules("GET https://api.example.com/x#frag")).toThrow();
  });

  it("classifies a line by the space a method prefix introduces", () => {
    expect(isKnownBlockedUrlRule("telemetry.example.com")).toBe(false);
    expect(isKnownBlockedUrlRule("*.example.com:443")).toBe(false);
    expect(isKnownBlockedUrlRule("~^a[.]example[.]com:443$")).toBe(false);
    expect(isKnownBlockedUrlRule("POST https://api.example.com/telemetry")).toBe(true);
    expect(isKnownBlockedUrlRule("* https://api.example.com")).toBe(true);
  });

  it("drops comments instead of completing them into a rule", () => {
    // Port completion would otherwise turn `# noisy` into `#:*` and `noisy:*`,
    // both valid, so the comment would silently become expected rules.
    expect(
      parseAndValidateKnownBlockedRules("# noisy\nnoisy.example.com  # telemetry"),
    ).toStrictEqual(["noisy.example.com:*"]);
  });

  it("rejects a # glued to a rule rather than completing it into a dead rule", () => {
    // Without a port, `noisy#c` used to gain `:*` and pass as `noisy#c:*`.
    expect(() => parseAndValidateKnownBlockedRules("noisy.example.com#c")).toThrow(/Invalid rule/);
  });

  it("still rejects a rule that is malformed for other reasons", () => {
    expect(() => parseAndValidateKnownBlockedRules("a*b.example.com")).toThrow();
  });

  it("does not apply to the other rule inputs, which name a real connection", () => {
    expect(() => parseAndValidateRules("a.example.com")).toThrow();
  });
});

reportResults();

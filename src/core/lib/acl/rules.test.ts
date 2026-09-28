import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import {
  buildACLRules,
  buildUrlRulesOrThrow,
  checkRulesCompileOrThrow,
  InvalidRulesError,
  parseIpRulesOrThrow,
  parseKnownBlockedRulesOrThrow,
  parseRulesOrThrow,
} from "./rules.ts";

// wildcard-rules.test.ts covers what counts as valid syntax. What is left here
// is the layer that turns a parser error into the action's own typed error, and
// the fan-out of the three rule inputs.

/** `a*b` is a wildcard in the middle of a label, which the parser rejects. */
const INVALID_RULE = "a*b.example.com:443";

function codeOfThrown(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e instanceof InvalidRulesError).toBe(true);
    return (e as InvalidRulesError).code;
  }
  throw new Error("expected the call to throw");
}

describe("parseRulesOrThrow", () => {
  it("returns the rules unchanged when they parse", () => {
    expect(parseRulesOrThrow("example.com:443 *.example.org:443")).toStrictEqual([
      "example.com:443",
      "*.example.org:443",
    ]);
  });

  it("returns an empty array for undefined and empty input", () => {
    expect(parseRulesOrThrow(undefined)).toStrictEqual([]);
    expect(parseRulesOrThrow("")).toStrictEqual([]);
  });

  it("rethrows a syntax error as InvalidRulesError with code INVALID_RULES", () => {
    expect(codeOfThrown(() => parseRulesOrThrow(INVALID_RULE))).toBe("INVALID_RULES");
  });

  it("keeps the parser's own message, so the user sees which rule was wrong", () => {
    expect(() => parseRulesOrThrow(INVALID_RULE)).toThrow(/a\*b\.example\.com/);
  });
});

describe("parseKnownBlockedRulesOrThrow", () => {
  it("completes a missing port rather than rejecting it", () => {
    expect(parseKnownBlockedRulesOrThrow("_mongodb._tcp.c0.example.net")).toStrictEqual([
      "_mongodb._tcp.c0.example.net:*",
    ]);
  });

  it("leaves a rule that already names a port alone", () => {
    expect(parseKnownBlockedRulesOrThrow("known-bad.example.com:443")).toStrictEqual([
      "known-bad.example.com:443",
    ]);
  });

  it("rethrows a syntax error as InvalidRulesError with code INVALID_RULES", () => {
    expect(codeOfThrown(() => parseKnownBlockedRulesOrThrow(INVALID_RULE))).toBe("INVALID_RULES");
  });
});

describe("parseIpRulesOrThrow", () => {
  it("accepts an address, a wildcard, a CIDR block and a regex", () => {
    const rules = ["10.0.0.5:443", "10.0.*.*:*", "10.0.0.1?:22", "10.0.0.0/8:443", "~^x:443$"];
    expect(parseIpRulesOrThrow(rules.join(" "))).toStrictEqual(rules);
  });

  it("refuses a rule that names a host, which the IP path would never match", () => {
    expect(codeOfThrown(() => parseIpRulesOrThrow("10.0.0.5:443 github.com:443"))).toBe(
      "INVALID_RULES",
    );
    expect(() => parseIpRulesOrThrow("github.com:443")).toThrow(/"github\.com:443" names a host/);
  });

  it("still rejects a syntax error first", () => {
    expect(() => parseIpRulesOrThrow(INVALID_RULE)).toThrow(/a\*b\.example\.com/);
  });

  for (const rule of [
    "010.0.0.0/8:5432",
    "010.0.0.1:443",
    "999.1.1.1:443",
    "256.0.0.1:443",
    "10.0.0.0/33:443",
    "10.0.0.0/08:443",
    "1.2.3:443",
    "10.0.*.010:443",
  ]) {
    it(`refuses ${rule}, which HAProxy would misread or reject`, () => {
      expect(codeOfThrown(() => parseIpRulesOrThrow(rule))).toBe("INVALID_RULES");
      expect(() => parseIpRulesOrThrow(rule)).toThrow(/is not an IPv4 address|Invalid CIDR block/);
    });
  }

  it("accepts the edges of the address and prefix ranges", () => {
    const rules = ["0.0.0.0:443", "0.0.0.0/0:443", "255.255.255.255/32:443"];
    expect(parseIpRulesOrThrow(rules.join(" "))).toStrictEqual(rules);
  });
});

describe("buildACLRules", () => {
  it("parses each input into its own field", () => {
    expect(
      buildACLRules({
        httpsRulesInput: "example.com:443",
        httpRulesInput: "plain.example.com:80",
        ipRulesInput: "10.0.0.1:1234",
      }),
    ).toStrictEqual({
      httpsRules: ["example.com:443"],
      httpRules: ["plain.example.com:80"],
      ipRules: ["10.0.0.1:1234"],
    });
  });

  it("returns empty arrays when every input is unset", () => {
    expect(
      buildACLRules({
        httpsRulesInput: undefined,
        httpRulesInput: undefined,
        ipRulesInput: undefined,
      }),
    ).toStrictEqual({ httpsRules: [], httpRules: [], ipRules: [] });
  });

  it("surfaces a bad rule from any one of the three inputs", () => {
    for (const input of ["httpsRulesInput", "httpRulesInput", "ipRulesInput"] as const) {
      expect(
        codeOfThrown(() =>
          buildACLRules({
            httpsRulesInput: undefined,
            httpRulesInput: undefined,
            ipRulesInput: undefined,
            [input]: INVALID_RULE,
          }),
        ),
      ).toBe("INVALID_RULES");
    }
  });

  it("refuses a host name in ipRulesInput alone", () => {
    const hosts = { httpsRulesInput: "github.com:443", httpRulesInput: "github.com:80" };
    expect(buildACLRules({ ...hosts, ipRulesInput: undefined }).httpsRules).toStrictEqual([
      "github.com:443",
    ]);
    expect(codeOfThrown(() => buildACLRules({ ...hosts, ipRulesInput: "github.com:443" }))).toBe(
      "INVALID_RULES",
    );
  });
});

describe("buildUrlRulesOrThrow", () => {
  it("returns the compiled rules when they parse", () => {
    expect(buildUrlRulesOrThrow("GET https://example.com/x").map((r) => r.raw)).toStrictEqual([
      "GET https://example.com/x",
    ]);
  });

  it("rethrows a syntax error as INVALID_RULES", () => {
    expect(codeOfThrown(() => buildUrlRulesOrThrow("GET not-a-url"))).toBe("INVALID_RULES");
  });
});

describe("checkRulesCompileOrThrow", () => {
  it("accepts every rule kind the container compiles", () => {
    expect(() =>
      checkRulesCompileOrThrow({
        httpsRules: ["*.example.com:443", "~(?:a|b)\\.example\\.com:443"],
        httpRules: ["example.com:80"],
        ipRules: ["10.0.0.0/8:443", "192.168.1.*:443"],
        tlsRules: ["db.example.com:443"],
        urlRules: buildUrlRulesOrThrow("GET https://abc*.example.com/**"),
      }),
    ).not.toThrow();
  });

  // Passes the setup parser, which lets a CIDR block through for IP rules, but
  // not the proxy's own host compiler.
  it("refuses, as INVALID_RULES, a rule only the container's compiler rejects", () => {
    expect(parseRulesOrThrow("10.0.0.0/8:443")).toStrictEqual(["10.0.0.0/8:443"]);
    expect(codeOfThrown(() => checkRulesCompileOrThrow({ httpsRules: ["10.0.0.0/8:443"] }))).toBe(
      "INVALID_RULES",
    );
  });
});

reportResults();

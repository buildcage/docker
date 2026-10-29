import { describe, it, expect, vi } from "vitest";

import {
  checkKnownBlockedUrlRuleSupport,
  checkUrlAndTlsRuleSupport,
} from "./engine-rule-support.ts";
import { InvalidInputError, type ProxyEngine } from "./inputs.ts";

const URL_RULE = "GET https://example.com";
const TLS_RULE = "example.com:443";
const KNOWN_BLOCKED_URL_RULE = "POST https://api.example.com/telemetry";

type Outcome = "none" | "warn" | "throw";

/** Runs a check and reports what it did: nothing, one warning, or an INVALID_PROXY_ENGINE error. */
function outcomeOf(check: (warn: (message: string) => void) => void): {
  outcome: Outcome;
  message?: string;
} {
  const warn = vi.fn();
  try {
    check(warn);
  } catch (e) {
    expect(warn).not.toHaveBeenCalled();
    expect(e).toStrictEqual(
      expect.objectContaining({ name: InvalidInputError.name, code: "INVALID_PROXY_ENGINE" }),
    );
    return { outcome: "throw", message: (e as Error).message };
  }
  if (warn.mock.calls.length === 0) return { outcome: "none" };
  expect(warn).toHaveBeenCalledTimes(1);
  return { outcome: "warn", message: warn.mock.calls[0][0] };
}

describe("checkUrlAndTlsRuleSupport", () => {
  it.each<[ProxyEngine, string, string[], string[], Outcome]>([
    ["inspect", "restrict", [URL_RULE], [TLS_RULE], "none"],
    ["inspect", "audit", [URL_RULE], [TLS_RULE], "none"],
    ["universal", "restrict", [], [], "none"],
    ["universal", "audit", [], [], "none"],
    ["universal", "restrict", [URL_RULE], [], "throw"],
    ["universal", "restrict", [], [TLS_RULE], "throw"],
    ["universal", "audit", [URL_RULE], [], "warn"],
    ["universal", "audit", [], [TLS_RULE], "warn"],
  ])(
    "on %s in %s mode with url %j and tls %j: %s",
    (proxyEngine, proxyMode, urlRules, tlsRules, expected) => {
      const { outcome } = outcomeOf((warn) =>
        checkUrlAndTlsRuleSupport({ proxyEngine, proxyMode, urlRules, tlsRules }, warn),
      );
      expect(outcome).toBe(expected);
    },
  );

  it.each<[string, string[], string[], Outcome, RegExp]>([
    ["restrict", [URL_RULE], [], "throw", /^allowed-url-rules has no effect/],
    ["restrict", [], [TLS_RULE], "throw", /^allowed-tls-rules has no effect/],
    [
      "restrict",
      [URL_RULE],
      [TLS_RULE],
      "throw",
      /^allowed-url-rules and allowed-tls-rules have no effect/,
    ],
    ["audit", [URL_RULE], [], "warn", /^allowed-url-rules has no effect/],
    ["audit", [], [TLS_RULE], "warn", /^allowed-tls-rules has no effect/],
    [
      "audit",
      [URL_RULE],
      [TLS_RULE],
      "warn",
      /^allowed-url-rules and allowed-tls-rules have no effect/,
    ],
  ])(
    "names only the rule inputs actually set (%s, url %j, tls %j)",
    (proxyMode, urlRules, tlsRules, expected, pattern) => {
      const { outcome, message } = outcomeOf((warn) =>
        checkUrlAndTlsRuleSupport(
          { proxyEngine: "universal", proxyMode, urlRules, tlsRules },
          warn,
        ),
      );
      expect(outcome).toBe(expected);
      expect(message).toMatch(pattern);
    },
  );
});

describe("checkKnownBlockedUrlRuleSupport", () => {
  it.each<[ProxyEngine, string, string[], Outcome]>([
    ["inspect", "restrict", [KNOWN_BLOCKED_URL_RULE], "none"],
    ["inspect", "audit", [KNOWN_BLOCKED_URL_RULE], "none"],
    ["universal", "restrict", [], "none"],
    ["universal", "audit", [], "none"],
    ["universal", "restrict", [KNOWN_BLOCKED_URL_RULE], "throw"],
    ["universal", "audit", [KNOWN_BLOCKED_URL_RULE], "warn"],
  ])(
    "on %s in %s mode with URL lines %j: %s",
    (proxyEngine, proxyMode, knownBlockedUrlRules, expected) => {
      const { outcome, message } = outcomeOf((warn) =>
        checkKnownBlockedUrlRuleSupport({ proxyEngine, proxyMode, knownBlockedUrlRules }, warn),
      );
      expect(outcome).toBe(expected);
      if (outcome !== "none") expect(message).toMatch(/known-blocked-rules/);
    },
  );
});

import { describe, it, expect, vi } from "vitest";

import { checkUrlAndTlsRuleSupport } from "./engine-rule-support.ts";
import { SetupError } from "./errors.ts";

describe("checkUrlAndTlsRuleSupport", () => {
  it("does nothing on inspect, regardless of mode or rules", () => {
    const warn = vi.fn();
    expect(() =>
      checkUrlAndTlsRuleSupport(
        {
          proxyEngine: "inspect",
          proxyMode: "restrict",
          urlRules: ["GET https://example.com"],
          tlsRules: ["example.com:443"],
        },
        warn,
      ),
    ).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it("does nothing when no url/tls rules are given, regardless of engine or mode", () => {
    const warn = vi.fn();
    expect(() =>
      checkUrlAndTlsRuleSupport(
        { proxyEngine: "universal", proxyMode: "restrict", urlRules: [], tlsRules: [] },
        warn,
      ),
    ).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it("throws INVALID_PROXY_ENGINE in restrict mode when the engine can't enforce url rules", () => {
    const warn = vi.fn();
    expect(() =>
      checkUrlAndTlsRuleSupport(
        {
          proxyEngine: "universal",
          proxyMode: "restrict",
          urlRules: ["GET https://example.com"],
          tlsRules: [],
        },
        warn,
      ),
    ).toThrow(SetupError);
    expect(warn).not.toHaveBeenCalled();
  });

  it("throws in explicit engine too, mentioning only the rule inputs actually set", () => {
    expect(() =>
      checkUrlAndTlsRuleSupport(
        {
          proxyEngine: "explicit",
          proxyMode: "restrict",
          urlRules: [],
          tlsRules: ["example.com:443"],
        },
        vi.fn(),
      ),
    ).toThrow(/allow_tls_rules/);
  });

  it("mentions both inputs when both are set", () => {
    try {
      checkUrlAndTlsRuleSupport(
        {
          proxyEngine: "universal",
          proxyMode: "restrict",
          urlRules: ["GET https://example.com"],
          tlsRules: ["example.com:443"],
        },
        vi.fn(),
      );
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toMatch(/allowed_url_rules and allow_tls_rules/);
    }
  });

  it("warns instead of throwing in audit mode", () => {
    const warn = vi.fn();
    expect(() =>
      checkUrlAndTlsRuleSupport(
        {
          proxyEngine: "universal",
          proxyMode: "audit",
          urlRules: ["GET https://example.com"],
          tlsRules: [],
        },
        warn,
      ),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/allowed_url_rules/);
  });
});

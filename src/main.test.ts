/**
 * Unit tests for main.ts
 *
 * Run with: vp test run src/main.test.ts
 */
import { describe, it, expect } from "vitest";

import { resolveBuildcageImageRef } from "#core/lib/provenance/image-ref.ts";
import { buildACLRules, resolveProxyEngine } from "./main.ts";

// ---------------------------------------------------------------------------
// resolveBuildcageImageRef
// ---------------------------------------------------------------------------

describe("resolveBuildcageImageRef", () => {
  it("uses IMAGE@DIGEST", () => {
    const digest = "sha256:" + "a".repeat(64);
    const result = resolveBuildcageImageRef({
      imageDigest: digest,
      actionRepository: "Owner/Repo",
    });
    expect(result).toBe(`ghcr.io/owner/repo@${digest}`);
  });

  it("lowercases the repository", () => {
    const digest = "sha256:" + "b".repeat(64);
    const result = resolveBuildcageImageRef({
      imageDigest: digest,
      actionRepository: "MyOrg/MyRepo",
    });
    expect(result.startsWith("ghcr.io/myorg/myrepo@")).toBeTruthy();
  });

  it("always derives repository from actionRepository (no external override)", () => {
    const digest = "sha256:" + "c".repeat(64);
    const result = resolveBuildcageImageRef({
      imageDigest: digest,
      actionRepository: "buildcage/docker",
    });
    expect(result.startsWith("ghcr.io/buildcage/docker@")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// resolveProxyEngine
// ---------------------------------------------------------------------------

describe("resolveProxyEngine", () => {
  it("defaults to transparent for undefined", () => {
    expect(resolveProxyEngine(undefined)).toBe("transparent");
  });

  it("defaults to transparent for empty string", () => {
    expect(resolveProxyEngine("")).toBe("transparent");
  });

  it("accepts transparent explicitly", () => {
    expect(resolveProxyEngine("transparent")).toBe("transparent");
  });

  it("accepts explicit", () => {
    expect(resolveProxyEngine("explicit")).toBe("explicit");
  });

  it("accepts inspect", () => {
    expect(resolveProxyEngine("inspect")).toBe("inspect");
  });

  it("throws SetupError for an invalid value", () => {
    expect(() => resolveProxyEngine("restrict")).toThrow();
  });

  it("throws SetupError for a value with different casing (case-sensitive)", () => {
    expect(() => resolveProxyEngine("Explicit")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// buildACLRules
// ---------------------------------------------------------------------------

describe("buildACLRules", () => {
  it("parses whitespace-separated HTTPS rules", () => {
    const { httpsRules } = buildACLRules({
      httpsRulesInput: "example.com:443 *.cdn.example.com:443",
      httpRulesInput: "",
      ipRulesInput: "",
    });
    expect(httpsRules).toStrictEqual(["example.com:443", "*.cdn.example.com:443"]);
  });

  it("handles newline-separated rules", () => {
    const { httpsRules } = buildACLRules({
      httpsRulesInput: "a.com:443\nb.com:443",
      httpRulesInput: "",
      ipRulesInput: "",
    });
    expect(httpsRules).toStrictEqual(["a.com:443", "b.com:443"]);
  });

  it("returns empty arrays for empty/undefined inputs", () => {
    const result = buildACLRules({
      httpsRulesInput: "",
      httpRulesInput: undefined,
      ipRulesInput: "   ",
    });
    expect(result.httpsRules).toStrictEqual([]);
    expect(result.httpRules).toStrictEqual([]);
    expect(result.ipRules).toStrictEqual([]);
  });

  it("throws for invalid rule syntax", () => {
    expect(() =>
      buildACLRules({
        httpsRulesInput: "no-port-specified",
        httpRulesInput: "",
        ipRulesInput: "",
      }),
    ).toThrow();
  });
});

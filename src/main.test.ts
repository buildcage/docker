/**
 * Unit tests for main.ts
 *
 * Run with: vp test run src/main.test.ts
 */
import { describe, it, expect, vi } from "vitest";

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
  it("defaults to universal for undefined", () => {
    expect(resolveProxyEngine(undefined)).toBe("universal");
  });

  it("defaults to universal for empty string", () => {
    expect(resolveProxyEngine("")).toBe("universal");
  });

  it("accepts universal explicitly", () => {
    expect(resolveProxyEngine("universal")).toBe("universal");
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

  // `transparent` is universal's old name, kept working permanently as an
  // alias — see ENGINE_ALIASES.
  describe("the transparent alias", () => {
    it("resolves transparent to universal", () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        expect(resolveProxyEngine("transparent")).toBe("universal");
      } finally {
        log.mockRestore();
      }
    });

    it("prints a ::notice:: pointing at the new name", () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        resolveProxyEngine("transparent");
        expect(log).toHaveBeenCalledWith(expect.stringContaining("::notice::"));
        expect(log).toHaveBeenCalledWith(expect.stringContaining("proxy_engine: transparent"));
        expect(log).toHaveBeenCalledWith(expect.stringContaining("proxy_engine: universal"));
      } finally {
        log.mockRestore();
      }
    });

    it("does not print a notice for any other value", () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        resolveProxyEngine("universal");
        resolveProxyEngine("explicit");
        resolveProxyEngine("inspect");
        expect(log).not.toHaveBeenCalled();
      } finally {
        log.mockRestore();
      }
    });

    it("no longer appears in the invalid-value error's accepted list", () => {
      expect(() => resolveProxyEngine("restrict")).toThrowError(/universal, explicit, inspect/);
    });
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

/**
 * Unit tests for setup/main.js
 *
 * Run with: node --test setup/src/main.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveBuildcageImageRef } from "./lib/image-ref.js";
import { buildACLRules, resolveProxyEngine } from "./main.js";

// ---------------------------------------------------------------------------
// resolveBuildcageImageRef
// ---------------------------------------------------------------------------

describe("resolveBuildcageImageRef", () => {
  it("uses IMAGE@DIGEST", () => {
    const digest = "sha256:" + "a".repeat(64);
    const result = resolveBuildcageImageRef({ imageDigest: digest, actionRepository: "Owner/Repo" });
    assert.equal(result, `ghcr.io/owner/repo@${digest}`);
  });

  it("lowercases the repository", () => {
    const digest = "sha256:" + "b".repeat(64);
    const result = resolveBuildcageImageRef({ imageDigest: digest, actionRepository: "MyOrg/MyRepo" });
    assert.ok(result.startsWith("ghcr.io/myorg/myrepo@"));
  });

  it("always derives repository from actionRepository (no external override)", () => {
    const digest = "sha256:" + "c".repeat(64);
    const result = resolveBuildcageImageRef({ imageDigest: digest, actionRepository: "dash14/buildcage" });
    assert.ok(result.startsWith("ghcr.io/dash14/buildcage@"));
  });
});

// ---------------------------------------------------------------------------
// resolveProxyEngine
// ---------------------------------------------------------------------------

describe("resolveProxyEngine", () => {
  it("defaults to transparent for undefined", () => {
    assert.equal(resolveProxyEngine(undefined), "transparent");
  });

  it("defaults to transparent for empty string", () => {
    assert.equal(resolveProxyEngine(""), "transparent");
  });

  it("accepts transparent explicitly", () => {
    assert.equal(resolveProxyEngine("transparent"), "transparent");
  });

  it("accepts explicit", () => {
    assert.equal(resolveProxyEngine("explicit"), "explicit");
  });

  it("throws SetupError for an invalid value", () => {
    assert.throws(
      () => resolveProxyEngine("restrict"),
      (err) => { assert.ok(err instanceof Error); return true; }
    );
  });

  it("throws SetupError for a value with different casing (case-sensitive)", () => {
    assert.throws(
      () => resolveProxyEngine("Explicit"),
      (err) => { assert.ok(err instanceof Error); return true; }
    );
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
    assert.deepEqual(httpsRules, ["example.com:443", "*.cdn.example.com:443"]);
  });

  it("handles newline-separated rules", () => {
    const { httpsRules } = buildACLRules({
      httpsRulesInput: "a.com:443\nb.com:443",
      httpRulesInput: "",
      ipRulesInput: "",
    });
    assert.deepEqual(httpsRules, ["a.com:443", "b.com:443"]);
  });

  it("returns empty arrays for empty/undefined inputs", () => {
    const result = buildACLRules({
      httpsRulesInput: "",
      httpRulesInput: undefined,
      ipRulesInput: "   ",
    });
    assert.deepEqual(result.httpsRules, []);
    assert.deepEqual(result.httpRules, []);
    assert.deepEqual(result.ipRules, []);
  });

  it("throws for invalid rule syntax", () => {
    assert.throws(
      () =>
        buildACLRules({
          httpsRulesInput: "no-port-specified",
          httpRulesInput: "",
          ipRulesInput: "",
        }),
      (err) => {
        assert.ok(err instanceof Error, "expected Error");
        return true;
      }
    );
  });
});

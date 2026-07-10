/**
 * Unit tests for setup/main.js
 *
 * Run with: node --test setup/src/main.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveBuildcageImageRef, resolveImageTag, buildACLRules, resolveProxyEngine } from "./main.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A stub for execFileSync that always succeeds (simulates image exists). */
const execOk = () => Buffer.from("{}");

/** A stub for execFileSync that always throws (simulates image not found). */
const execFail = () => { throw new Error("manifest not found"); };

// ---------------------------------------------------------------------------
// resolveImageTag
// ---------------------------------------------------------------------------

describe("resolveImageTag", () => {
  it("converts a 40-char hex SHA to sha-<sha> by default (no suffix for transparent)", () => {
    const sha = "a".repeat(40);
    const result = resolveImageTag("ghcr.io/owner/repo", { actionRef: sha }, execOk);
    assert.equal(result, `sha-${"a".repeat(40)}`);
  });

  it("strips leading 'v' from a version tag", () => {
    const result = resolveImageTag("ghcr.io/owner/repo", { actionRef: "v2.1.0" }, execOk);
    assert.equal(result, "2.1.0");
  });

  it("strips leading 'v' from a major-only tag", () => {
    const result = resolveImageTag("ghcr.io/owner/repo", { actionRef: "v3" }, execOk);
    assert.equal(result, "3");
  });

  it("uses branch name as-is when image exists", () => {
    const result = resolveImageTag("ghcr.io/owner/repo", { actionRef: "main" }, execOk);
    assert.equal(result, "main");
  });

  it("uses the explicit engine suffix when requested", () => {
    const result = resolveImageTag("ghcr.io/owner/repo", { actionRef: "v2.1.0", proxyEngine: "explicit" }, execOk);
    assert.equal(result, "2.1.0-explicit");
  });

  it("throws when docker manifest inspect fails (tag not found)", () => {
    assert.throws(
      () => resolveImageTag("ghcr.io/owner/repo", { actionRef: "v2.1.0" }, execFail),
      (err) => { assert.ok(err instanceof Error); return true; }
    );
  });

  it("throws when actionRef is empty string", () => {
    assert.throws(
      () => resolveImageTag("ghcr.io/owner/repo", { actionRef: "" }, execOk),
      (err) => { assert.ok(err instanceof Error); return true; }
    );
  });

  it("throws when actionRef is undefined", () => {
    assert.throws(
      () => resolveImageTag("ghcr.io/owner/repo", { actionRef: undefined }, execOk),
      (err) => { assert.ok(err instanceof Error); return true; }
    );
  });

  it("lowercases a SHA-derived tag", () => {
    const sha = "ABCDEF1234".padEnd(40, "0");
    const result = resolveImageTag("ghcr.io/owner/repo", { actionRef: sha }, execOk);
    assert.equal(result, `sha-${sha.toLowerCase()}`);
  });
});

// ---------------------------------------------------------------------------
// resolveBuildcageImageRef
// ---------------------------------------------------------------------------

describe("resolveBuildcageImageRef", () => {
  it("uses IMAGE@DIGEST when imageDigest is provided", () => {
    const digest = "sha256:" + "a".repeat(64);
    const result = resolveBuildcageImageRef(
      { imageDigest: digest, actionRepository: "Owner/Repo", actionRef: "v2.1.0" },
      execOk
    );
    assert.equal(result, `ghcr.io/owner/repo@${digest}`);
  });

  it("lowercases the repository when using digest", () => {
    const digest = "sha256:" + "b".repeat(64);
    const result = resolveBuildcageImageRef(
      { imageDigest: digest, actionRepository: "MyOrg/MyRepo", actionRef: "v2.1.0" },
      execOk
    );
    assert.ok(result.startsWith("ghcr.io/myorg/myrepo@"));
  });

  it("falls back to tag reference when imageDigest is empty string", () => {
    const result = resolveBuildcageImageRef(
      { imageDigest: "", actionRepository: "owner/repo", actionRef: "v2.1.0" },
      execOk
    );
    assert.equal(result, "ghcr.io/owner/repo:2.1.0");
  });

  it("falls back to tag reference when imageDigest is undefined", () => {
    const result = resolveBuildcageImageRef(
      { imageDigest: undefined, actionRepository: "owner/repo", actionRef: "v2.1.0" },
      execOk
    );
    assert.equal(result, "ghcr.io/owner/repo:2.1.0");
  });

  it("uses the explicit engine's tag suffix when requested", () => {
    const result = resolveBuildcageImageRef(
      { imageDigest: undefined, actionRepository: "owner/repo", actionRef: "v2.1.0", proxyEngine: "explicit" },
      execOk
    );
    assert.equal(result, "ghcr.io/owner/repo:2.1.0-explicit");
  });

  it("always derives repository from actionRepository (no external override)", () => {
    const result = resolveBuildcageImageRef(
      { imageDigest: "", actionRepository: "dash14/buildcage", actionRef: "v2.1.0" },
      execOk
    );
    assert.ok(result.startsWith("ghcr.io/dash14/buildcage:"));
  });

  it("throws when manifest inspect fails and no digest", () => {
    assert.throws(
      () => resolveBuildcageImageRef(
        { imageDigest: "", actionRepository: "owner/repo", actionRef: "v2.1.0" },
        execFail
      ),
      (err) => { assert.ok(err instanceof Error); return true; }
    );
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

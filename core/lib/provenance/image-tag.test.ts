/**
 * Unit tests for core/lib/provenance/image-tag.ts
 *
 * Run with: vp test run core/lib/provenance/image-tag.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { imageTagFromRef } from "./image-tag.ts";

describe("imageTagFromRef", () => {
  it("converts a 40-char hex SHA to sha-<sha> by default (no suffix for transparent)", () => {
    const sha = "a".repeat(40);
    assert.equal(imageTagFromRef(sha), `sha-${"a".repeat(40)}`);
  });

  it("lowercases the SHA", () => {
    const sha = "ABCDEF1234".padEnd(40, "0");
    assert.equal(imageTagFromRef(sha), `sha-${sha.toLowerCase()}`);
  });

  it("strips leading 'v' from a version tag", () => {
    assert.equal(imageTagFromRef("v2.1.0"), "2.1.0");
  });

  it("strips 'v' from a major-only tag", () => {
    assert.equal(imageTagFromRef("v2"), "2");
  });

  it("returns a branch name as-is, with no suffix for the default engine", () => {
    assert.equal(imageTagFromRef("main"), "main");
  });

  it("returns empty string for empty input", () => {
    assert.equal(imageTagFromRef(""), "");
  });

  it("returns empty string for undefined", () => {
    assert.equal(imageTagFromRef(undefined), "");
  });

  it("appends the explicit engine suffix instead when requested", () => {
    assert.equal(imageTagFromRef("v2.1.0", "explicit"), "2.1.0-explicit");
    assert.equal(imageTagFromRef("a".repeat(40), "explicit"), `sha-${"a".repeat(40)}-explicit`);
  });
});

/**
 * Unit tests for core/lib/provenance/image-tag.ts
 *
 * Run with: vp test run core/lib/provenance/image-tag.test.ts
 */
import { describe, it, expect } from "vitest";

import { imageTagFromRef } from "./image-tag.ts";

describe("imageTagFromRef", () => {
  it("converts a 40-char hex SHA to sha-<sha> by default (no suffix for transparent)", () => {
    const sha = "a".repeat(40);
    expect(imageTagFromRef(sha)).toBe(`sha-${"a".repeat(40)}`);
  });

  it("lowercases the SHA", () => {
    const sha = "ABCDEF1234".padEnd(40, "0");
    expect(imageTagFromRef(sha)).toBe(`sha-${sha.toLowerCase()}`);
  });

  it("strips leading 'v' from a version tag", () => {
    expect(imageTagFromRef("v2.1.0")).toBe("2.1.0");
  });

  it("strips 'v' from a major-only tag", () => {
    expect(imageTagFromRef("v2")).toBe("2");
  });

  it("returns a branch name as-is, with no suffix for the default engine", () => {
    expect(imageTagFromRef("main")).toBe("main");
  });

  it("returns empty string for empty input", () => {
    expect(imageTagFromRef("")).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(imageTagFromRef(undefined)).toBe("");
  });

  it("appends the explicit engine suffix instead when requested", () => {
    expect(imageTagFromRef("v2.1.0", "explicit")).toBe("2.1.0-explicit");
    expect(imageTagFromRef("a".repeat(40), "explicit")).toBe(`sha-${"a".repeat(40)}-explicit`);
  });

  it("gives every non-default engine its own suffix", () => {
    // A new engine is a separately published image, so forgetting the suffix
    // would silently pull the transparent one.
    expect(imageTagFromRef("v2.1.0", "inspect")).toBe("2.1.0-inspect");
    expect(imageTagFromRef("v2.1.0", "proxy")).toBe("2.1.0-proxy");
  });
});

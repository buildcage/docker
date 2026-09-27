import { describe, it, expect } from "vitest";
import { resolveBuildcageImageRef } from "./image-ref.ts";

describe("resolveBuildcageImageRef", () => {
  it("pins the image by digest rather than by tag", () => {
    const digest = "sha256:" + "a".repeat(64);
    expect(resolveBuildcageImageRef({ imageDigest: digest, actionRepository: "owner/repo" })).toBe(
      `ghcr.io/owner/repo@${digest}`,
    );
  });

  it("lowercases the repository, since GitHub preserves owner/repo case but GHCR does not accept it", () => {
    const digest = "sha256:" + "b".repeat(64);
    expect(
      resolveBuildcageImageRef({ imageDigest: digest, actionRepository: "MyOrg/MyRepo" }),
    ).toBe(`ghcr.io/myorg/myrepo@${digest}`);
  });

  it("derives the repository from actionRepository alone, there being no override to pass", () => {
    const digest = "sha256:" + "c".repeat(64);
    expect(resolveBuildcageImageRef({ imageDigest: digest, actionRepository: "Owner/Repo" })).toBe(
      `ghcr.io/owner/repo@${digest}`,
    );
  });
});

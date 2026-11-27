import { describe, it, expect } from "vitest";

import { imageTagForCommit } from "./image-tag.ts";

describe("imageTagForCommit", () => {
  it("tags a commit's build with sha-<commit> and the engine suffix", () => {
    expect(imageTagForCommit("a".repeat(40), "universal")).toBe(`sha-${"a".repeat(40)}-universal`);
    expect(imageTagForCommit("a".repeat(40), "inspect")).toBe(`sha-${"a".repeat(40)}-inspect`);
  });
});

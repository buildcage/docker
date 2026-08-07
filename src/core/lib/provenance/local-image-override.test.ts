import { describe, it, expect } from "vitest";

import { readLocalImageOverride } from "./local-image-override.ts";

describe("readLocalImageOverride", () => {
  it("returns null when BUILDCAGE_LOCAL_IMAGE_REF is unset", () => {
    expect(readLocalImageOverride({})).toBe(null);
  });

  it("returns null when BUILDCAGE_LOCAL_IMAGE_REF is an empty string", () => {
    expect(readLocalImageOverride({ BUILDCAGE_LOCAL_IMAGE_REF: "" })).toBe(null);
  });

  it("returns the literal image ref and pullPolicy 'never' when set", () => {
    const result = readLocalImageOverride({ BUILDCAGE_LOCAL_IMAGE_REF: "buildcage-builder" });
    expect(result).toStrictEqual({ imageRef: "buildcage-builder", pullPolicy: "never" });
  });
});

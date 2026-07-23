import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { readLocalImageOverride } from "./local-image-override.ts";

describe("readLocalImageOverride", () => {
  it("returns null when BUILDCAGE_LOCAL_IMAGE_REF is unset", () => {
    assert.equal(readLocalImageOverride({}), null);
  });

  it("returns null when BUILDCAGE_LOCAL_IMAGE_REF is an empty string", () => {
    assert.equal(readLocalImageOverride({ BUILDCAGE_LOCAL_IMAGE_REF: "" }), null);
  });

  it("returns the literal image ref and pullPolicy 'never' when set", () => {
    const result = readLocalImageOverride({ BUILDCAGE_LOCAL_IMAGE_REF: "buildcage-builder" });
    assert.deepEqual(result, { imageRef: "buildcage-builder", pullPolicy: "never" });
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { generateContainerName, getContainerPid } from "./container.js";

describe("generateContainerName", () => {
  it("always starts with the buildcage-sandbox- prefix", () => {
    assert.match(generateContainerName(), /^buildcage-sandbox-[0-9a-f]{8}$/);
  });

  it("produces distinct names across calls", () => {
    const names = new Set(Array.from({ length: 20 }, () => generateContainerName()));
    assert.equal(names.size, 20);
  });
});

describe("getContainerPid", () => {
  it("returns null for a container that doesn't exist", () => {
    assert.equal(getContainerPid("buildcage-sandbox-this-should-not-exist-anywhere"), null);
  });
});

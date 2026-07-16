import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { generateContainerName, getContainerPid, deriveProjectName } from "./container.js";

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

describe("deriveProjectName", () => {
  it("returns the container name unchanged", () => {
    assert.equal(deriveProjectName("buildcage-sandbox-abcd1234"), "buildcage-sandbox-abcd1234");
  });

  it("matches docker compose's project-name character constraints for any generated container name", () => {
    for (let i = 0; i < 20; i++) {
      const projectName = deriveProjectName(generateContainerName());
      assert.match(projectName, /^[a-z0-9][a-z0-9_-]*$/);
    }
  });
});

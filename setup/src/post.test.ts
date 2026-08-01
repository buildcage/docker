import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { deriveProjectName } from "../../core/lib/docker/container.ts";
import { resolveProjectName } from "./post.ts";

// The override gate is fixed at module load, so both cases below exercise
// the "disabled" path — matching a normal build/test run.
describe("resolveProjectName", () => {
  it("falls back to deriveProjectName(builderName) when COMPOSE_PROJECT_NAME is unset", () => {
    assert.equal(
      resolveProjectName("buildcage-transparent-audit", {}),
      deriveProjectName("buildcage-transparent-audit"),
    );
  });

  it("ignores COMPOSE_PROJECT_NAME when the test-hooks gate isn't on for this build", () => {
    assert.equal(
      resolveProjectName("buildcage-transparent-audit", {
        COMPOSE_PROJECT_NAME: "buildcage-project",
      }),
      deriveProjectName("buildcage-transparent-audit"),
    );
  });
});

import { describe, it, assert, reportResults } from "../test/test-shim.ts";
import { deriveProjectName, resolveProjectName } from "./compose-project-name.ts";

describe("deriveProjectName", () => {
  it("is deterministic — same input always derives the same project name", () => {
    assert.equal(
      deriveProjectName("buildcage-proxy-abcd1234"),
      deriveProjectName("buildcage-proxy-abcd1234"),
    );
  });

  it("matches docker compose's project-name character constraints, even for input Compose would reject", () => {
    assert.match(deriveProjectName("buildcage-proxy-abcd1234"), /^[a-z0-9][a-z0-9_-]*$/);
    assert.match(deriveProjectName("buildcage"), /^[a-z0-9][a-z0-9_-]*$/);
    // Uppercase/other characters are a valid Docker container name (what
    // setup's builder_name input only ever had to be before this
    // function's result started being used as a Compose -p value too) but
    // not a valid Compose project name on their own.
    assert.match(deriveProjectName("MyBuilder"), /^[a-z0-9][a-z0-9_-]*$/);
    assert.match(deriveProjectName("My.Builder_2"), /^[a-z0-9][a-z0-9_-]*$/);
  });

  it("derives different project names for different inputs", () => {
    assert.ok(deriveProjectName("buildcage") !== deriveProjectName("buildcage2"));
  });
});

describe("resolveProjectName", () => {
  it("falls back to deriveProjectName(builderName) when there's no override", () => {
    assert.equal(
      resolveProjectName("buildcage-transparent-audit", undefined),
      deriveProjectName("buildcage-transparent-audit"),
    );
  });

  it("prefers the override when given one", () => {
    assert.equal(
      resolveProjectName("buildcage-transparent-audit", "buildcage-project"),
      "buildcage-project",
    );
  });
});

reportResults();

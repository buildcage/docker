import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import { deriveProjectName, resolveProjectName } from "./compose-project-name.ts";

describe("deriveProjectName", () => {
  it("is deterministic — same input always derives the same project name", () => {
    expect(deriveProjectName("buildcage-proxy-abcd1234")).toBe(
      deriveProjectName("buildcage-proxy-abcd1234"),
    );
  });

  it("matches docker compose's project-name character constraints, even for input Compose would reject", () => {
    expect(deriveProjectName("buildcage-proxy-abcd1234")).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
    expect(deriveProjectName("buildcage")).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
    // Uppercase/other characters are a valid Docker container name (what
    // setup's builder_name input only ever had to be before this
    // function's result started being used as a Compose -p value too) but
    // not a valid Compose project name on their own.
    expect(deriveProjectName("MyBuilder")).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
    expect(deriveProjectName("My.Builder_2")).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
  });

  it("derives different project names for different inputs", () => {
    expect(deriveProjectName("buildcage") !== deriveProjectName("buildcage2")).toBeTruthy();
  });
});

describe("resolveProjectName", () => {
  it("falls back to deriveProjectName(builderName) when there's no override", () => {
    expect(resolveProjectName("buildcage-transparent-audit", undefined)).toBe(
      deriveProjectName("buildcage-transparent-audit"),
    );
  });

  it("prefers the override when given one", () => {
    expect(resolveProjectName("buildcage-transparent-audit", "buildcage-project")).toBe(
      "buildcage-project",
    );
  });
});

reportResults();

import { describe, it, expect } from "vitest";
import { deriveProjectName, resolveProjectName } from "./compose-project-name.ts";

describe("deriveProjectName", () => {
  it("is deterministic: same input always derives the same project name", () => {
    expect(deriveProjectName("buildcage-proxy-abcd1234")).toBe(
      deriveProjectName("buildcage-proxy-abcd1234"),
    );
  });

  it("matches docker compose's project-name character constraints, even for input Compose would reject", () => {
    expect(deriveProjectName("buildcage-proxy-abcd1234")).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
    expect(deriveProjectName("buildcage")).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
    // Uppercase and other characters are valid in a Docker container name,
    // which is all setup's builder_name input has to be, but not in a Compose
    // project name.
    expect(deriveProjectName("MyBuilder")).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
    expect(deriveProjectName("My.Builder_2")).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
  });

  it("derives different project names for different inputs", () => {
    expect(deriveProjectName("buildcage") !== deriveProjectName("buildcage2")).toBeTruthy();
  });
});

describe("resolveProjectName", () => {
  it("falls back to deriveProjectName(builderName) when there's no override", () => {
    expect(resolveProjectName("buildcage-universal-audit", undefined)).toBe(
      deriveProjectName("buildcage-universal-audit"),
    );
  });

  it("prefers the override when given one", () => {
    expect(resolveProjectName("buildcage-universal-audit", "buildcage-project")).toBe(
      "buildcage-project",
    );
  });
});

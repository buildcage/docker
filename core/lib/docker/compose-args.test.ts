import { describe, it, assert, reportResults } from "../test/test-shim.ts";
import { buildComposeUpArgs, buildComposeDownArgs } from "./compose-args.ts";

// Regression guard for the concurrent-step container/network collision:
// both must always include "-p" + the project name, or Compose falls back
// to an implicit, directory-derived project name shared by every
// concurrent step in the job.

describe("buildComposeUpArgs", () => {
  it("always includes -p <projectName> alongside -f <composeFile>", () => {
    const args = buildComposeUpArgs({
      composeFile: "/path/to/compose.yaml",
      projectName: "buildcage-proxy-abcd1234",
      pullPolicy: "always",
    });
    assert.deepEqual(args, [
      "compose",
      "-f",
      "/path/to/compose.yaml",
      "-p",
      "buildcage-proxy-abcd1234",
      "up",
      "-d",
      "--pull",
      "always",
      "--no-build",
      "--wait",
      "--quiet-pull",
    ]);
  });
});

describe("buildComposeDownArgs", () => {
  it("always includes -p <projectName> alongside -f <composeFile>", () => {
    const args = buildComposeDownArgs({
      composeFile: "/path/to/compose.yaml",
      projectName: "buildcage-proxy-abcd1234",
    });
    assert.deepEqual(args, [
      "compose",
      "-f",
      "/path/to/compose.yaml",
      "-p",
      "buildcage-proxy-abcd1234",
      "down",
    ]);
  });
});

reportResults();

import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import { buildDockerCpArgs, buildComposeUpArgs, buildComposeDownArgs } from "./args.ts";

describe("buildDockerCpArgs", () => {
  it("builds a `docker cp <container>:<containerPath> <hostPath>` argv", () => {
    expect(
      buildDockerCpArgs({
        containerName: "buildcage-proxy-abcd1234",
        containerPath: "/opt/buildcage/bin/runc",
        hostPath: "/tmp/x/runc",
      }),
    ).toStrictEqual(["cp", "buildcage-proxy-abcd1234:/opt/buildcage/bin/runc", "/tmp/x/runc"]);
  });
});

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
    expect(args).toStrictEqual([
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
    expect(args).toStrictEqual([
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

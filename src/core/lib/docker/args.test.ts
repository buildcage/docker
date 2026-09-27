import { describe, it, expect } from "vitest";

import {
  buildDockerCpArgs,
  buildComposeUpArgs,
  buildComposeDownArgs,
  buildComposeLogsArgs,
} from "./args.ts";

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
      "--wait-timeout",
      "180",
      "--quiet-pull",
    ]);
  });
});

describe("buildComposeLogsArgs", () => {
  it("builds a tailed, uncolored `docker compose ... logs` argv", () => {
    expect(
      buildComposeLogsArgs({
        composeFile: "/path/to/compose.yaml",
        projectName: "buildcage-proxy-abcd1234",
        tail: 100,
      }),
    ).toStrictEqual([
      "compose",
      "-f",
      "/path/to/compose.yaml",
      "-p",
      "buildcage-proxy-abcd1234",
      "logs",
      "--no-color",
      "--tail",
      "100",
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

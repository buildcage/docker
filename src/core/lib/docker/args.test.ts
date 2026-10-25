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
      composeFiles: ["/path/to/compose.yaml"],
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
        composeFiles: ["/path/to/compose.yaml"],
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
  it("passes every compose file in order, so a later one overrides an earlier one", () => {
    expect(
      buildComposeDownArgs({
        composeFiles: ["/path/to/compose.yaml", "/path/to/overlay.yaml"],
        projectName: "buildcage-proxy-abcd1234",
      }).slice(0, 5),
    ).toStrictEqual(["compose", "-f", "/path/to/compose.yaml", "-f", "/path/to/overlay.yaml"]);
  });

  it("includes -p <projectName> alongside -f <composeFile>, and removes volumes", () => {
    const args = buildComposeDownArgs({
      composeFiles: ["/path/to/compose.yaml"],
      projectName: "buildcage-proxy-abcd1234",
    });
    expect(args).toStrictEqual([
      "compose",
      "-f",
      "/path/to/compose.yaml",
      "-p",
      "buildcage-proxy-abcd1234",
      "down",
      "-v",
    ]);
  });
});

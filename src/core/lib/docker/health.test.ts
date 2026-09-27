import { describe, it, expect } from "vitest";

import {
  buildDockerInspectStateArgs,
  parseContainerState,
  isContainerReady,
  describeContainerStartFailure,
} from "./health.ts";

describe("buildDockerInspectStateArgs", () => {
  it("asks for .State as JSON", () => {
    expect(buildDockerInspectStateArgs("buildcage")).toStrictEqual([
      "inspect",
      "--format",
      "{{json .State}}",
      "buildcage",
    ]);
  });
});

describe("parseContainerState", () => {
  it("reads the status, exit code, health and the last probe's output", () => {
    const output = JSON.stringify({
      Status: "running",
      ExitCode: 0,
      Health: {
        Status: "unhealthy",
        Log: [{ Output: "first\n" }, { Output: "error: failed to list workers: Unavailable\n" }],
      },
    });
    expect(parseContainerState(output)).toStrictEqual({
      status: "running",
      exitCode: 0,
      health: "unhealthy",
      lastHealthOutput: "error: failed to list workers: Unavailable",
    });
  });

  it("leaves health null for an image without a healthcheck", () => {
    expect(parseContainerState(JSON.stringify({ Status: "exited", ExitCode: 137 }))).toStrictEqual({
      status: "exited",
      exitCode: 137,
      health: null,
      lastHealthOutput: null,
    });
  });

  it("returns null for a non-state payload", () => {
    expect(parseContainerState("")).toBe(null);
    expect(parseContainerState("[]")).toBe(null);
    expect(parseContainerState("{}")).toBe(null);
  });

  it("reads a state with no exit code, health or log as nulls", () => {
    expect(parseContainerState(JSON.stringify({ Status: "running" }))).toStrictEqual({
      status: "running",
      exitCode: null,
      health: null,
      lastHealthOutput: null,
    });
  });

  it("reads whitespace-only health output as no output at all", () => {
    const output = JSON.stringify({
      Status: "running",
      ExitCode: 0,
      Health: { Status: "starting", Log: [{ Output: "   \n" }] },
    });
    expect(parseContainerState(output)?.lastHealthOutput).toBe(null);
  });
});

describe("isContainerReady", () => {
  const state = { status: "running", exitCode: 0, health: null, lastHealthOutput: null };

  it("accepts a running container whose healthcheck passed", () => {
    expect(isContainerReady({ ...state, health: "healthy" })).toBe(true);
  });

  it("accepts a running container that has no healthcheck at all", () => {
    expect(isContainerReady(state)).toBe(true);
  });

  it("rejects unhealthy, still-starting and stopped containers", () => {
    expect(isContainerReady({ ...state, health: "unhealthy" })).toBe(false);
    expect(isContainerReady({ ...state, health: "starting" })).toBe(false);
    expect(isContainerReady({ ...state, status: "exited", exitCode: 1 })).toBe(false);
  });
});

describe("describeContainerStartFailure", () => {
  it("reports the exit code when the container stopped", () => {
    const message = describeContainerStartFailure(
      { status: "exited", exitCode: 1, health: null, lastHealthOutput: null },
      { role: "builder", containerName: "buildcage" },
    );
    expect(message).toMatch(/builder container \(buildcage\) stopped with code 1/);
  });

  it("names the container by the caller's own role word", () => {
    const message = describeContainerStartFailure(
      {
        status: "running",
        exitCode: 0,
        health: "unhealthy",
        lastHealthOutput: "failed to list workers",
      },
      { role: "sandbox proxy", containerName: "buildcage-proxy-abcd1234" },
    );
    expect(message).toMatch(/sandbox proxy container \(buildcage-proxy-abcd1234\)/);
    expect(message).toMatch(/never became ready/);
    expect(message).toMatch(/failed to list workers/);
  });

  it("points at Docker's own output when the container looks fine", () => {
    const message = describeContainerStartFailure(
      { status: "running", exitCode: 0, health: "healthy", lastHealthOutput: null },
      { role: "builder", containerName: "buildcage" },
    );
    expect(message).toMatch(/is running, but `docker compose up` failed/);
  });

  it("reports a stopped container with no exit code without naming one", () => {
    const message = describeContainerStartFailure(
      { status: "exited", exitCode: null, health: null, lastHealthOutput: null },
      { role: "proxy", containerName: "buildcage" },
    );
    expect(message).toMatch(/stopped instead of starting up/);
  });
});

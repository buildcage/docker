import { describe, it, expect } from "vitest";

import { describeDockerFailure, isLikelySlimRunner } from "./docker-error.ts";

describe("describeDockerFailure", () => {
  const noSlimRunner = { env: {}, exists: () => false };

  it("flags a missing docker binary distinctly for ENOENT", () => {
    const msg = describeDockerFailure(
      { code: "ENOENT" },
      { operation: "docker compose up", ...noSlimRunner },
    );
    expect(msg).toMatch(/not found on this runner's PATH/);
    expect(msg).toMatch(/docker compose up/);
  });

  it("points at the log above (not e.message) when stderr wasn't captured", () => {
    const msg = describeDockerFailure(
      { status: 1, message: "Command failed: docker compose up ...huge...args..." },
      noSlimRunner,
    );
    expect(msg).not.toMatch(/huge\.\.\.args/);
    expect(msg).toMatch(/see the Docker output above/);
  });

  it("includes captured stderr text when present", () => {
    const msg = describeDockerFailure(
      { status: 1, stderr: "error: no such object: foo" },
      noSlimRunner,
    );
    expect(msg).toMatch(/error: no such object: foo/);
  });

  it("names ubuntu-slim as unsupported and ubuntu-latest as the working default", () => {
    const msg = describeDockerFailure({ code: "ENOENT" }, noSlimRunner);
    expect(msg).toMatch(/ubuntu-slim/);
    expect(msg).toMatch(/ubuntu-latest/);
  });

  it("defaults the operation label to 'docker' when omitted", () => {
    expect(describeDockerFailure({ code: "ENOENT" }, noSlimRunner)).toMatch(/running docker\./);
  });

  it("adds a detection note when the runner looks like a container-based image", () => {
    const withNote = describeDockerFailure(
      { code: "ENOENT" },
      { env: { ImageOS: "Linux" }, exists: () => true },
    );
    const withoutNote = describeDockerFailure({ code: "ENOENT" }, noSlimRunner);
    expect(withNote).toMatch(/Detected a container-based GitHub-hosted runner image/);
    expect(withoutNote).not.toMatch(/Detected a container-based GitHub-hosted runner image/);
  });
});

describe("isLikelySlimRunner", () => {
  it("detects when ImageOS is Linux and the containerenv marker exists", () => {
    expect(isLikelySlimRunner({ ImageOS: "Linux" }, () => true)).toBe(true);
  });

  it("returns false when ImageOS looks like a normal VM image", () => {
    expect(isLikelySlimRunner({ ImageOS: "ubuntu24" }, () => true)).toBe(false);
  });

  it("returns false when the containerenv marker is missing", () => {
    expect(isLikelySlimRunner({ ImageOS: "Linux" }, () => false)).toBe(false);
  });

  it("returns false when ImageOS is unset", () => {
    expect(isLikelySlimRunner({}, () => true)).toBe(false);
  });
});

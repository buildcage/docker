import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { describeDockerFailure, isLikelySlimRunner } from "./docker-error.js";

describe("describeDockerFailure", () => {
  const noSlimRunner = { env: {}, exists: () => false };

  it("flags a missing docker binary distinctly for ENOENT", () => {
    const msg = describeDockerFailure({ code: "ENOENT" }, { operation: "docker compose up", ...noSlimRunner });
    assert.match(msg, /not found on this runner's PATH/);
    assert.match(msg, /docker compose up/);
  });

  it("points at the log above (not e.message) when stderr wasn't captured", () => {
    const msg = describeDockerFailure(
      { status: 1, message: "Command failed: docker compose up ...huge...args..." },
      noSlimRunner,
    );
    assert.doesNotMatch(msg, /huge\.\.\.args/);
    assert.match(msg, /see the Docker output above/);
  });

  it("includes captured stderr text when present", () => {
    const msg = describeDockerFailure({ status: 1, stderr: "error: no such object: foo" }, noSlimRunner);
    assert.match(msg, /error: no such object: foo/);
  });

  it("names ubuntu-slim as unsupported and ubuntu-latest as the working default", () => {
    const msg = describeDockerFailure({ code: "ENOENT" }, noSlimRunner);
    assert.match(msg, /ubuntu-slim/);
    assert.match(msg, /ubuntu-latest/);
  });

  it("defaults the operation label to 'docker' when omitted", () => {
    assert.match(describeDockerFailure({ code: "ENOENT" }, noSlimRunner), /running docker\./);
  });

  it("adds a detection note when the runner looks like a container-based image", () => {
    const withNote = describeDockerFailure({ code: "ENOENT" }, { env: { ImageOS: "Linux" }, exists: () => true });
    const withoutNote = describeDockerFailure({ code: "ENOENT" }, noSlimRunner);
    assert.match(withNote, /Detected a container-based GitHub-hosted runner image/);
    assert.doesNotMatch(withoutNote, /Detected a container-based GitHub-hosted runner image/);
  });
});

describe("isLikelySlimRunner", () => {
  it("detects when ImageOS is Linux and the containerenv marker exists", () => {
    assert.equal(isLikelySlimRunner({ ImageOS: "Linux" }, () => true), true);
  });

  it("returns false when ImageOS looks like a normal VM image", () => {
    assert.equal(isLikelySlimRunner({ ImageOS: "ubuntu24" }, () => true), false);
  });

  it("returns false when the containerenv marker is missing", () => {
    assert.equal(isLikelySlimRunner({ ImageOS: "Linux" }, () => false), false);
  });

  it("returns false when ImageOS is unset", () => {
    assert.equal(isLikelySlimRunner({}, () => true), false);
  });
});

import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { generateContainerName, getContainerPid, isContainerNotFoundError } from "./container.ts";
import { deriveProjectName } from "../../../core/lib/docker/compose-project-name.ts";
import { SandboxError } from "./errors.ts";

describe("generateContainerName", () => {
  it("always starts with the buildcage-proxy- prefix", () => {
    assert.match(generateContainerName(), /^buildcage-proxy-[0-9a-f]{8}$/);
  });

  it("produces distinct names across calls", () => {
    const names = new Set(Array.from({ length: 20 }, () => generateContainerName()));
    assert.equal(names.size, 20);
  });
});

describe("getContainerPid", () => {
  it("returns null for a container that doesn't exist (no real docker needed)", () => {
    const fakeExec = () => {
      throw { stderr: "error: no such object: buildcage-proxy-xyz" };
    };
    assert.equal(getContainerPid("buildcage-proxy-xyz", { exec: fakeExec }), null);
  });

  it("parses the PID from a successful docker inspect", () => {
    const fakeExec = () => "12345\n";
    assert.equal(getContainerPid("buildcage-proxy-abc", { exec: fakeExec }), 12345);
  });

  it("returns null when docker inspect prints a non-numeric/empty PID", () => {
    const fakeExec = () => "\n";
    assert.equal(getContainerPid("buildcage-proxy-abc", { exec: fakeExec }), null);
  });

  it("throws SandboxError with DOCKER_UNAVAILABLE when docker is unreachable", () => {
    const fakeExec = () => {
      throw { stderr: "Cannot connect to the Docker daemon at unix:///var/run/docker.sock" };
    };
    assert.throws(
      () => getContainerPid("buildcage-proxy-abc", { exec: fakeExec }),
      (err) => err instanceof SandboxError && err.code === "DOCKER_UNAVAILABLE",
    );
  });
});

describe("isContainerNotFoundError", () => {
  it("recognizes docker's 'no such object' wording", () => {
    assert.equal(
      isContainerNotFoundError({ stderr: "error: no such object: buildcage-proxy-xyz" }),
      true,
    );
  });

  it("recognizes docker's 'no such container' wording", () => {
    assert.equal(
      isContainerNotFoundError({ stderr: "Error: No such container: buildcage-proxy-xyz" }),
      true,
    );
  });

  it("does not misclassify a daemon-unreachable failure", () => {
    assert.equal(
      isContainerNotFoundError({
        stderr: "Cannot connect to the Docker daemon at unix:///var/run/docker.sock",
      }),
      false,
    );
  });

  it("does not misclassify an ENOENT (docker not on PATH)", () => {
    assert.equal(isContainerNotFoundError({ code: "ENOENT" }), false);
  });
});

// General deriveProjectName tests live in core/lib/docker/container.test.ts;
// this one is specific to run's own container-name format.
describe("deriveProjectName", () => {
  it("matches docker compose's project-name character constraints for any generated container name", () => {
    for (let i = 0; i < 20; i++) {
      const projectName = deriveProjectName(generateContainerName());
      assert.match(projectName, /^[a-z0-9][a-z0-9_-]*$/);
    }
  });
});

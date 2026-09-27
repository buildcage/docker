import { describe, it, expect } from "vitest";

import type { Docker } from "#core/lib/docker/client.ts";

import { readActionVersion } from "./action-version.ts";

function dockerReturning(labels: Record<string, string> | Error): Docker {
  return {
    findContainers: () => [],
    copyFromContainer: () => {},
    readFileLines: () => (async function* () {})(),
    readEnv: () => ({}),
    readLabels: () => {
      if (labels instanceof Error) throw labels;
      return labels;
    },
    exec: () => "",
  };
}

const VERSION_LABEL = "org.opencontainers.image.version";

describe("readActionVersion", () => {
  it("turns the version label back into its git tag", () => {
    const docker = dockerReturning({ [VERSION_LABEL]: "3.1.4" });
    expect(readActionVersion(docker, "abc", "universal")).toBe("v3.1.4");
  });

  it("strips this engine's own tag suffix", () => {
    const docker = dockerReturning({ [VERSION_LABEL]: "3.1.4-inspect" });
    expect(readActionVersion(docker, "abc", "inspect")).toBe("v3.1.4");
  });

  it("leaves a suffix belonging to another engine alone", () => {
    const docker = dockerReturning({ [VERSION_LABEL]: "3.1.4-inspect" });
    expect(readActionVersion(docker, "abc", "universal")).toBe("v3.1.4-inspect");
  });

  it("returns undefined when the image carries no version label", () => {
    expect(readActionVersion(dockerReturning({}), "abc", "universal")).toBeUndefined();
  });

  it("returns undefined when docker inspect fails", () => {
    const docker = dockerReturning(new Error("no such object"));
    expect(readActionVersion(docker, "abc", "universal")).toBeUndefined();
  });
});

import { describe, it, expect } from "vitest";

import type { Docker } from "./client.ts";
import { readResolverAnswered, readResolverLogDeaths } from "./resolver-health.ts";

function fakeDocker(exec: Docker["exec"]): { docker: Docker; calls: string[][] } {
  const calls: string[][] = [];
  const docker: Docker = {
    findContainers: () => [],
    copyFromContainer: () => {},
    readEnv: () => ({}),
    readLabels: () => ({}),
    exec: (id, args) => {
      calls.push([id, ...args]);
      return exec(id, args);
    },
    async *execLines() {
      yield* [];
    },
  };
  return { docker, calls };
}

describe("readResolverAnswered", () => {
  it("asks the resolver's health check inside the container", () => {
    const { docker, calls } = fakeDocker(() => "OK");
    expect(readResolverAnswered(docker, "abc")).toBe(true);
    expect(calls).toStrictEqual([
      ["abc", "curl", "-sf", "--max-time", "10", "http://127.0.0.1:8080/health"],
    ]);
  });

  it("returns false when the resolver does not answer", () => {
    const { docker } = fakeDocker(() => {
      throw new Error("exit 7");
    });
    expect(readResolverAnswered(docker, "abc")).toBe(false);
  });
});

describe("readResolverLogDeaths", () => {
  it("counts one death per line of the log writer's death tally", () => {
    const { docker, calls } = fakeDocker(
      () => "@400000006aea742d18027a67 signal SIGKILL\n@400000006aea74333aafec3b signal SIGKILL\n",
    );
    expect(readResolverLogDeaths(docker, "abc")).toBe(2);
    expect(calls).toStrictEqual([["abc", "s6-svdt", "/run/service/coredns-log"]]);
  });

  it("reads an empty tally as no death", () => {
    const { docker } = fakeDocker(() => "");
    expect(readResolverLogDeaths(docker, "abc")).toBe(0);
  });

  it("returns undefined when the tally cannot be read", () => {
    const { docker } = fakeDocker(() => {
      throw new Error("exit 111");
    });
    expect(readResolverLogDeaths(docker, "abc")).toBeUndefined();
  });
});

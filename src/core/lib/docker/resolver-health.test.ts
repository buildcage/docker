import { describe, it, expect } from "vitest";

import type { Docker } from "./client.ts";
import { readResolverAnswered, readResolverLogStarts } from "./resolver-health.ts";

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

describe("readResolverLogStarts", () => {
  it("counts the lines of the log writer's starts file", () => {
    const { docker, calls } = fakeDocker(() => "\n\n");
    expect(readResolverLogStarts(docker, "abc")).toBe(2);
    expect(calls).toStrictEqual([["abc", "cat", "/var/run/coredns-log/starts"]]);
  });

  it("returns undefined when the file cannot be read", () => {
    const { docker } = fakeDocker(() => {
      throw new Error("exit 1");
    });
    expect(readResolverLogStarts(docker, "abc")).toBeUndefined();
  });
});

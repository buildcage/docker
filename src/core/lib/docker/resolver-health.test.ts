import { describe, it, expect } from "vitest";

import type { Docker } from "./client.ts";
import { readResolverAnswered } from "./resolver-health.ts";

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
    async *readFileLines() {
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

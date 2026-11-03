import { describe, it, expect } from "vitest";

import type { Docker } from "./client.ts";
import { readStartLedger } from "./start-ledger.ts";

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

describe("readStartLedger", () => {
  it("counts the file's lines", () => {
    const { docker, calls } = fakeDocker(() => "\n\n");
    expect(readStartLedger(docker, "abc", "/var/run/x/starts")).toBe(2);
    expect(calls).toStrictEqual([["abc", "cat", "/var/run/x/starts"]]);
  });

  it("leaves an empty file unknown", () => {
    const { docker } = fakeDocker(() => "");
    expect(readStartLedger(docker, "abc", "/var/run/x/starts")).toBeUndefined();
  });

  it("leaves a file it cannot read unknown", () => {
    const { docker } = fakeDocker(() => {
      throw new Error("exit 1");
    });
    expect(readStartLedger(docker, "abc", "/var/run/x/starts")).toBeUndefined();
  });
});

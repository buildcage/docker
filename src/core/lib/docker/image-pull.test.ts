import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, it, expect } from "vitest";

import type { SpawnCommand } from "./client.ts";
import { startImagePull } from "./image-pull.ts";

/** Just enough of a ChildProcess for startImagePull. */
class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;
  kill() {
    this.killed = true;
    this.signalCode = "SIGTERM";
    this.emit("close", null, "SIGTERM");
  }
  finish(code: number, stderr = "") {
    this.stderr.end(stderr);
    // stderr's data has to arrive before close, as it does from a real child.
    setImmediate(() => {
      this.exitCode = code;
      this.emit("close", code, null);
    });
  }
}

function fakeSpawn(): { spawnDocker: SpawnCommand; calls: string[][]; child: () => FakeChild } {
  const calls: string[][] = [];
  let last: FakeChild | undefined;
  return {
    calls,
    child: () => last!,
    spawnDocker(args) {
      calls.push(args);
      last = new FakeChild();
      return last as unknown as ReturnType<SpawnCommand>;
    },
  };
}

describe("startImagePull", () => {
  it("runs a quiet docker pull of the given ref right away", () => {
    const { spawnDocker, calls } = fakeSpawn();
    startImagePull("ghcr.io/buildcage/x@sha256:abc", spawnDocker);
    expect(calls).toStrictEqual([["pull", "--quiet", "ghcr.io/buildcage/x@sha256:abc"]]);
  });

  it("resolves when the pull exits 0", async () => {
    const { spawnDocker, child } = fakeSpawn();
    const pull = startImagePull("ref", spawnDocker);
    child().finish(0);
    await expect(pull.finished).resolves.toBeUndefined();
  });

  it("rejects with the exit status and the captured stderr when the pull fails", async () => {
    const { spawnDocker, child } = fakeSpawn();
    const pull = startImagePull("ref", spawnDocker);
    child().finish(1, "manifest unknown\n");
    await expect(pull.finished).rejects.toMatchObject({
      status: 1,
      stderr: "manifest unknown\n",
      message: "docker pull exited with code 1: manifest unknown",
    });
  });

  it("rejects with Node's own error when docker cannot be spawned", async () => {
    const { spawnDocker, child } = fakeSpawn();
    const pull = startImagePull("ref", spawnDocker);
    child().emit("error", Object.assign(new Error("spawn docker ENOENT"), { code: "ENOENT" }));
    await expect(pull.finished).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("kills a pull still running when cancelled, and reports the signal", async () => {
    const { spawnDocker, child } = fakeSpawn();
    const pull = startImagePull("ref", spawnDocker);
    pull.cancel();
    expect(child().killed).toBe(true);
    await expect(pull.finished).rejects.toMatchObject({
      message: "docker pull exited with code null (signal SIGTERM): ",
    });
  });

  it("leaves a pull that has already exited alone when cancelled", async () => {
    const { spawnDocker, child } = fakeSpawn();
    const pull = startImagePull("ref", spawnDocker);
    child().finish(0);
    await pull.finished;
    pull.cancel();
    expect(child().killed).toBe(false);
  });

  it("does not leave an unhandled rejection when nobody waits for a failed pull", async () => {
    const { spawnDocker, child } = fakeSpawn();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      startImagePull("ref", spawnDocker);
      child().finish(1);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unhandled).toStrictEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

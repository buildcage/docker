import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import { createDocker, parseContainerIds, type SpawnCommand } from "./client.ts";
import { REPORT_ACTION_SCRIPT_PATH } from "./report-source.ts";

describe("parseContainerIds", () => {
  it("splits one ID per line", () => {
    expect(parseContainerIds("abc123\ndef456\n")).toStrictEqual(["abc123", "def456"]);
  });

  it("returns an empty array for empty output", () => {
    expect(parseContainerIds("")).toStrictEqual([]);
  });

  it("drops blank lines and trims whitespace", () => {
    expect(parseContainerIds("\n  abc123  \n\n")).toStrictEqual(["abc123"]);
  });
});

// Records every invocation's argv and returns a scripted response per call,
// so each test can assert both "what was run" and "what came back".
function fakeRun(responses: string[]): { run: (args: string[]) => string; calls: string[][] } {
  const calls: string[][] = [];
  let i = 0;
  return {
    calls,
    run(args: string[]) {
      calls.push(args);
      return responses[i++] ?? "";
    },
  };
}

describe("createDocker", () => {
  it("findContainers ANDs every filter and parses the ID list", () => {
    const { run, calls } = fakeRun(["abc123\ndef456\n"]);
    const ids = createDocker(run).findContainers(["label=a=1", "label=b=2"]);
    expect(ids).toStrictEqual(["abc123", "def456"]);
    expect(calls).toStrictEqual([
      ["ps", "--filter", "label=a=1", "--filter", "label=b=2", "--format", "{{.ID}}"],
    ]);
  });

  it("copyFromContainer runs a docker cp with containerId:containerPath -> hostPath", () => {
    const { run, calls } = fakeRun([""]);
    createDocker(run).copyFromContainer(
      "abc123",
      REPORT_ACTION_SCRIPT_PATH,
      "/tmp/report-action.js",
    );
    expect(calls).toStrictEqual([
      ["cp", `abc123:${REPORT_ACTION_SCRIPT_PATH}`, "/tmp/report-action.js"],
    ]);
  });

  it("readEnv runs docker inspect and parses the Env JSON array", () => {
    const { run, calls } = fakeRun(['["PROXY_MODE=restrict","FOO=bar"]']);
    const env = createDocker(run).readEnv("abc123");
    expect(env).toStrictEqual({ PROXY_MODE: "restrict", FOO: "bar" });
    expect(calls).toStrictEqual([["inspect", "abc123", "--format", "{{json .Config.Env}}"]]);
  });

  it("exec runs docker exec with the given argv and returns its stdout", () => {
    const { run, calls } = fakeRun(["histories output"]);
    const out = createDocker(run).exec("abc123", [
      "buildctl",
      "debug",
      "histories",
      "--format",
      "{{json .}}",
    ]);
    expect(out).toBe("histories output");
    expect(calls).toStrictEqual([
      ["exec", "abc123", "buildctl", "debug", "histories", "--format", "{{json .}}"],
    ]);
  });
});

/** Minimal stand-in for node:child_process's ChildProcess, just enough
 *  surface for streamDockerLines: stdout/stderr streams, 'error'/'close'
 *  events, exitCode/signalCode, and a kill() the test can observe. */
class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;
  kill() {
    this.killed = true;
    this.signalCode = "SIGTERM";
    this.stdout.end();
    this.emit("close", null, "SIGTERM");
  }
  finish(code: number) {
    this.exitCode = code;
    this.stdout.end();
    this.stderr.end();
    this.emit("close", code, null);
  }
  failToSpawn(err: NodeJS.ErrnoException) {
    this.emit("error", err);
    this.stdout.end();
    this.stderr.end();
    this.emit("close", null, null);
  }
}

// Same shape as fakeRun, but for the spawn-based second constructor param.
function fakeSpawn(): { spawnDocker: SpawnCommand; calls: string[][]; children: FakeChild[] } {
  const calls: string[][] = [];
  const children: FakeChild[] = [];
  return {
    calls,
    children,
    spawnDocker(args: string[]) {
      calls.push(args);
      const child = new FakeChild();
      children.push(child);
      return child as unknown as ReturnType<SpawnCommand>;
    },
  };
}

async function drain(iterable: AsyncIterable<string>): Promise<string[]> {
  const lines: string[] = [];
  for await (const line of iterable) lines.push(line);
  return lines;
}

describe("createDocker readFileLines", () => {
  it("is lazy — nothing spawns until iteration actually starts", () => {
    const { spawnDocker, calls } = fakeSpawn();
    createDocker(undefined, spawnDocker).readFileLines("abc123", "/var/log/haproxy/current");
    expect(calls).toStrictEqual([]);
  });

  it("streams docker exec cat's stdout as lines, in argv order", async () => {
    const { spawnDocker, calls, children } = fakeSpawn();
    const iterablePromise = drain(
      createDocker(undefined, spawnDocker).readFileLines("abc123", "/var/log/haproxy/current"),
    );
    // drain()'s first pull has already triggered the spawn synchronously.
    expect(calls).toStrictEqual([["exec", "abc123", "cat", "/var/log/haproxy/current"]]);
    children[0].stdout.write("line one\nline two\n");
    children[0].finish(0);
    expect(await iterablePromise).toStrictEqual(["line one", "line two"]);
  });

  it("throws {status, stderr} on a non-zero exit", async () => {
    const { spawnDocker, children } = fakeSpawn();
    const drained = drain(createDocker(undefined, spawnDocker).readFileLines("abc123", "/missing"));
    // Ensure the child has been created before driving it.
    await Promise.resolve();
    children[0].stderr.write("cat: /missing: No such file or directory\n");
    children[0].finish(1);
    await expect(drained).rejects.toSatisfy(
      (e) =>
        (e as { status?: number; stderr?: string }).status === 1 &&
        Boolean((e as { stderr?: string }).stderr?.includes("No such file or directory")),
    );
  });

  it("surfaces a spawn-level ENOENT as-is", async () => {
    const { spawnDocker, children } = fakeSpawn();
    const drained = drain(createDocker(undefined, spawnDocker).readFileLines("abc123", "/path"));
    await Promise.resolve();
    children[0].failToSpawn(Object.assign(new Error("spawn docker ENOENT"), { code: "ENOENT" }));
    await expect(drained).rejects.toSatisfy((e) => (e as NodeJS.ErrnoException).code === "ENOENT");
  });

  it("kills the child if the consumer stops iterating early", async () => {
    const { spawnDocker, children } = fakeSpawn();
    const iterable = createDocker(undefined, spawnDocker).readFileLines(
      "abc123",
      "/var/log/haproxy/current",
    );
    const iterator = iterable[Symbol.asyncIterator]();
    // .next() runs synchronously through spawnDocker(args), so the child
    // already exists once this returns.
    const firstLine = iterator.next();
    children[0].stdout.write("line one\nline two\n"); // never finish()'d — simulates a still-running process
    expect((await firstLine).value).toBe("line one");
    await iterator.return?.(undefined); // what `for await...of` does on an early break
    expect(children[0].killed).toBeTruthy();
  });
});

reportResults();

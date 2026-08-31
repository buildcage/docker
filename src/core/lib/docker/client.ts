import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { buildDockerCpArgs } from "./args.ts";
import { parseDockerInspectEnv, parseDockerInspectLabels } from "./container-env.ts";

/** `docker ps --format '{{.ID}}'` prints one ID per line, possibly with
 *  trailing blank lines. */
export function parseContainerIds(psOutput: string): string[] {
  return psOutput
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

export type RunCommand = (args: string[]) => string;
export type SpawnCommand = (args: string[]) => ChildProcess;

// 64MB, up from Node's 1MB default — `buildctl debug logs --progress=rawjson`
// output for a verbose build can exceed the default easily.
function defaultRunCommand(args: string[]): string {
  return execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function defaultSpawnCommand(args: string[]): ChildProcess {
  return spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * Drives a `docker <args>` child process and yields its stdout line by
 * line, never buffering more than the current line. Lazy — nothing spawns
 * until the caller starts iterating.
 *
 * Throws `{status, stderr}` on a non-zero exit and Node's own
 * `{code: "ENOENT", ...}` on a spawn failure, matching the shape
 * describeDockerFailure() (core/lib/actions/docker-error.ts) expects from
 * execFileSync elsewhere in this module.
 */
async function* streamDockerLines(
  spawnDocker: SpawnCommand,
  args: string[],
  operation: string,
): AsyncGenerator<string, void, void> {
  const child = spawnDocker(args);

  // Must be attached before any `await` — an EventEmitter with no 'error'
  // listener throws synchronously the instant one fires.
  let spawnError: NodeJS.ErrnoException | undefined;
  child.on("error", (err) => {
    spawnError = err as NodeJS.ErrnoException;
  });

  // Registered up front too, so a 'close' firing while suspended at `yield`
  // can't be missed.
  const closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }> = once(
    child,
    "close",
  ).then(
    ([code, signal]) => ({ code, signal }),
    () => ({ code: null, signal: null }),
  );

  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const rl = createInterface({ input: child.stdout!, crlfDelay: Infinity });

  // True only if stdout was drained to EOF on its own, not if the consumer
  // broke out early — that distinction decides whether reaching the end is
  // a failure or a deliberate stop.
  let exhausted = false;
  try {
    for await (const line of rl) {
      yield line;
    }
    exhausted = true;
  } finally {
    rl.close();
    if (!exhausted && child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
  }

  if (!exhausted) return;

  const { code, signal } = await closed;
  if (spawnError) throw spawnError;
  if (code !== 0) {
    throw Object.assign(
      new Error(
        `${operation} exited with code ${code}${signal ? ` (signal ${signal})` : ""}: ${stderr.trim()}`,
      ),
      { status: code ?? undefined, stderr },
    );
  }
}

export interface Docker {
  /** Container IDs matching every given `docker ps --filter` expression (AND'd together). */
  findContainers(filters: string[]): string[];
  /** `docker cp <containerId>:<containerPath> <hostPath>`. */
  copyFromContainer(containerId: string, containerPath: string, hostPath: string): void;
  /** `docker exec <containerId> cat <path>`, streamed one line at a time —
   *  see streamDockerLines() for the error-shape/cleanup contract. */
  readFileLines(containerId: string, path: string): AsyncIterable<string>;
  /** `docker inspect <containerId>`'s own env, as a lookup map. */
  readEnv(containerId: string): Record<string, string>;
  /** `docker inspect <containerId>`'s own labels, as a lookup map. */
  readLabels(containerId: string): Record<string, string>;
  /** `docker exec <containerId> <...args>` — raw stdout, for anything else
   *  (e.g. buildctl). */
  exec(containerId: string, args: string[]): string;
}

/** `run`/`spawnDocker` are injectable so tests can assert on argv instead of
 *  mocking node:child_process directly. */
export function createDocker(
  run: RunCommand = defaultRunCommand,
  spawnDocker: SpawnCommand = defaultSpawnCommand,
): Docker {
  return {
    findContainers(filters) {
      const args = ["ps"];
      for (const filter of filters) args.push("--filter", filter);
      args.push("--format", "{{.ID}}");
      return parseContainerIds(run(args));
    },
    copyFromContainer(containerId, containerPath, hostPath) {
      run(buildDockerCpArgs({ containerName: containerId, containerPath, hostPath }));
    },
    readFileLines(containerId, path) {
      return streamDockerLines(
        spawnDocker,
        ["exec", containerId, "cat", path],
        `docker exec cat ${path}`,
      );
    },
    readEnv(containerId) {
      return parseDockerInspectEnv(
        run(["inspect", containerId, "--format", "{{json .Config.Env}}"]),
      );
    },
    readLabels(containerId) {
      return parseDockerInspectLabels(
        run(["inspect", containerId, "--format", "{{json .Config.Labels}}"]),
      );
    },
    exec(containerId, args) {
      return run(["exec", containerId, ...args]);
    },
  };
}

import { execFileSync } from "node:child_process";
import { buildDockerCpArgs } from "./container.ts";
import { parseDockerInspectEnv } from "./container-env.ts";

/** `docker ps --format '{{.ID}}'` prints one ID per line, possibly with
 *  trailing blank lines. */
export function parseContainerIds(psOutput: string): string[] {
  return psOutput.split("\n").map((s) => s.trim()).filter(Boolean);
}

export type RunCommand = (args: string[]) => string;

// 64MB, up from Node's 1MB default — `buildctl debug logs --progress=rawjson`
// output for a verbose build can exceed the default easily.
function defaultRunCommand(args: string[]): string {
  return execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

export interface Docker {
  /** Container IDs matching every given `docker ps --filter` expression (AND'd together). */
  findContainers(filters: string[]): string[];
  /** `docker cp <containerId>:<containerPath> <hostPath>`. */
  copyFromContainer(containerId: string, containerPath: string, hostPath: string): void;
  /** `docker exec <containerId> cat <path>` — the file's contents. */
  readFile(containerId: string, path: string): string;
  /** `docker inspect <containerId>`'s own env, as a lookup map. */
  readEnv(containerId: string): Record<string, string>;
  /** `docker exec <containerId> <...args>` — raw stdout, for anything else
   *  (e.g. buildctl). */
  exec(containerId: string, args: string[]): string;
}

/**
 * All docker-facing I/O (container discovery, file/log/env fetch) that
 * report generation needs, behind one small interface. Every caller takes
 * a `Docker` instance rather than shelling out itself, so tests can inject
 * a fake `run` and assert on the argv it was called with, instead of
 * mocking node:child_process directly.
 */
export function createDocker(run: RunCommand = defaultRunCommand): Docker {
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
    readFile(containerId, path) {
      return run(["exec", containerId, "cat", path]);
    },
    readEnv(containerId) {
      return parseDockerInspectEnv(run(["inspect", containerId, "--format", "{{json .Config.Env}}"]));
    },
    exec(containerId, args) {
      return run(["exec", containerId, ...args]);
    },
  };
}

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

import { describeDockerFailure, type DockerErrorLike } from "#core/lib/actions/docker-error.ts";
import { SandboxError } from "./errors.ts";

/**
 * Each `run` step gets its own throwaway proxy container (start -> run ->
 * report -> stop) rather than reusing one across steps, so a random name
 * avoids collisions across concurrent/successive steps by construction.
 */
export function generateContainerName(): string {
  return `buildcage-proxy-${randomBytes(4).toString("hex")}`;
}

/**
 * Distinguishes "this container doesn't exist" (docker's own wording, e.g.
 * `no such object`) from "docker itself is unusable on this runner" — both
 * phrasings are matched for resilience across docker CLI versions.
 */
export function isContainerNotFoundError(e: unknown): boolean {
  const err = (e && typeof e === "object" ? e : {}) as DockerErrorLike;
  const text = `${err.stderr ?? ""} ${err.message ?? ""}`.toLowerCase();
  return text.includes("no such object") || text.includes("no such container");
}

/**
 * Null means "container doesn't exist yet" (see isContainerNotFoundError);
 * any other docker failure throws a SandboxError instead, so it isn't
 * confused with that case at the call site.
 *
 * `exec` is an injectable seam for testing without a real Docker daemon —
 * not a caller-facing precondition.
 */
interface ExecFileSyncOptions {
  encoding: string;
  stdio: string[];
  env: NodeJS.ProcessEnv;
}

type ExecFileSyncLike = (command: string, args: string[], options: ExecFileSyncOptions) => string;

export interface GetContainerPidOptions {
  exec?: ExecFileSyncLike;
}

export function getContainerPid(
  containerName: string,
  { exec = execFileSync as unknown as ExecFileSyncLike }: GetContainerPidOptions = {},
): number | null {
  let out;
  try {
    out = exec(
      "docker",
      ["inspect", "--format", "{{.State.Pid}}", containerName],
      // LC_ALL=C pins docker's own CLI error text to English regardless of
      // the runner's system locale, since isContainerNotFoundError below
      // depends on matching that text.
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LC_ALL: "C" } },
    ).trim();
  } catch (e) {
    if (isContainerNotFoundError(e)) return null;
    throw new SandboxError(
      describeDockerFailure(e, { operation: "docker inspect" }),
      "DOCKER_UNAVAILABLE",
    );
  }
  const pid = Number(out);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

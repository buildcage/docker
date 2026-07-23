// @ts-nocheck
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

import { describeDockerFailure } from "../../../core/lib/actions/docker-error.js";
import { SandboxError } from "./errors.js";

/**
 * Each `run` step gets its own throwaway proxy container (start -> run ->
 * report -> stop) rather than reusing one across steps, so a random name
 * avoids collisions across concurrent/successive steps by construction.
 */
export function generateContainerName() {
  return `buildcage-proxy-${randomBytes(4).toString("hex")}`;
}

/**
 * Reused as the Compose project name (separate Docker namespace from
 * container names, so no collision). Passing an explicit, per-container
 * project name matters when `run` steps in the same job run truly
 * concurrently (GitHub Actions' `background`/`wait`/`parallel` keywords):
 * without it, Compose falls back to one shared, directory-derived project
 * name, and a concurrent `up`/`down` from a different step can recreate or
 * tear down another step's still-running proxy container.
 */
export function deriveProjectName(containerName) {
  return containerName;
}

/**
 * Used to pull runc and gen-seccomp-profile out of the proxy image before
 * the isolated command runs (see lib/isolated-exec.js).
 */
export function buildDockerCpArgs({ containerName, containerPath, hostPath }) {
  return ["cp", `${containerName}:${containerPath}`, hostPath];
}

/**
 * Distinguishes "this container doesn't exist" (docker's own wording, e.g.
 * `no such object`) from "docker itself is unusable on this runner" — both
 * phrasings are matched for resilience across docker CLI versions.
 */
export function isContainerNotFoundError(e) {
  const text = `${e?.stderr ?? ""} ${e?.message ?? ""}`.toLowerCase();
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
export function getContainerPid(containerName, { exec = execFileSync } = {}) {
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

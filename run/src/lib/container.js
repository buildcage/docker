import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

/**
 * Generate a unique container name for this run step. Each `run`
 * step gets its own throwaway proxy container (start -> run -> report ->
 * stop, all within one step) rather than reusing one across steps, so
 * name collisions across concurrent/successive steps are avoided by
 * construction.
 */
export function generateContainerName() {
  return `buildcage-proxy-${randomBytes(4).toString("hex")}`;
}

/**
 * Derive the docker compose project name to use for this step's proxy
 * container. Container names and Compose project names live in separate
 * Docker namespaces, so reusing the exact same string for both is safe,
 * and correlating them 1:1 makes `docker ps` / `docker network ls`
 * debugging trivial when troubleshooting a specific concurrent step.
 *
 * Passing this explicitly via `-p` on every `docker compose` invocation is
 * required when multiple `run` steps in the same job run truly
 * concurrently (see GitHub Actions' `background`/`wait`/`parallel` step
 * keywords) — without it, Compose falls back to an implicit,
 * directory-derived project name shared by every invocation, and it
 * identifies "the" container for a service by project+service label
 * rather than by container name. A concurrent `up`/`down` from a
 * different step can then recreate or tear down another step's
 * still-running proxy container even though their container names never
 * collide.
 */
export function deriveProjectName(containerName) {
  return containerName;
}

/**
 * Build the `docker cp` argv for extracting a single file from a running
 * container onto the host filesystem — used to pull runc and
 * gen-seccomp-profile out of the proxy image before run-isolated.sh runs
 * (see lib/isolated-exec.js).
 */
export function buildDockerCpArgs({ containerName, containerPath, hostPath }) {
  return ["cp", `${containerName}:${containerPath}`, hostPath];
}

/**
 * Returns the container's PID (as seen from the Docker host's PID
 * namespace), or null if the container doesn't exist / isn't running.
 */
export function getContainerPid(containerName) {
  try {
    const out = execFileSync(
      "docker",
      ["inspect", "--format", "{{.State.Pid}}", containerName],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    const pid = Number(out);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

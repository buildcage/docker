import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

/**
 * Generate a unique container name for this sandbox step. Each `sandbox`
 * step gets its own throwaway proxy container (start -> run -> report ->
 * stop, all within one step) rather than reusing one across steps, so
 * name collisions across concurrent/successive steps are avoided by
 * construction.
 */
export function generateContainerName() {
  return `buildcage-sandbox-${randomBytes(4).toString("hex")}`;
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

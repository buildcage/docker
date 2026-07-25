import { createHash } from "node:crypto";

/**
 * Derives a Compose project name (a separate Docker namespace from
 * container names, so no collision risk there) from a container/builder
 * name. Passing an explicit, deterministic project name matters when
 * multiple steps/containers in the same job run concurrently: without it,
 * Compose falls back to one shared, directory-derived project name, and a
 * concurrent `up`/`down`/`ps` from a different step can recreate, tear
 * down, or misidentify another step's container.
 *
 * Hashed rather than used verbatim: Compose project names are constrained
 * to `^[a-z0-9][a-z0-9_-]*$`, but the input here can be a user-supplied
 * `builder_name` (setup/report's own input, which only ever had to be a
 * valid Docker container name — a wider character set, e.g. uppercase) or
 * run's own randomly-generated container name. A hex digest is always
 * within Compose's charset regardless of what the input looked like, so
 * this never needs to validate or reject its input.
 */
export function deriveProjectName(containerName: string): string {
  const hash = createHash("sha256").update(containerName).digest("hex").slice(0, 12);
  return `buildcage-${hash}`;
}

/**
 * Used to pull a file out of a running container via `docker cp`.
 */
export interface BuildDockerCpArgsOptions {
  containerName: string;
  containerPath: string;
  hostPath: string;
}

export function buildDockerCpArgs({
  containerName,
  containerPath,
  hostPath,
}: BuildDockerCpArgsOptions): string[] {
  return ["cp", `${containerName}:${containerPath}`, hostPath];
}

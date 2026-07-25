/**
 * Reused as the Compose project name (separate Docker namespace from
 * container names, so no collision). Passing an explicit, per-container
 * project name matters when multiple steps/containers in the same job run
 * concurrently: without it, Compose falls back to one shared, directory-
 * derived project name, and a concurrent `up`/`down`/`ps` from a different
 * step can recreate, tear down, or misidentify another step's container.
 */
export function deriveProjectName(containerName: string): string {
  return containerName;
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

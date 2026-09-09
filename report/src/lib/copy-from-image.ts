import { execFileSync } from "node:child_process";

export type RunDocker = (args: string[]) => string;

// stderr is piped, not inherited, so describeDockerFailure can quote it.
const runDocker: RunDocker = (args) =>
  execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/**
 * Copies a path out of the image `containerId` was created from, so a `RUN`
 * step that escaped its sandbox and wrote into the container cannot reach the
 * runner through it. The image ID comes from the daemon's record of the
 * container, which nothing inside it can rewrite, and the scratch container is
 * never started, so what comes out is the image's own copy.
 */
export function copyFromContainerImage(
  containerId: string,
  containerPath: string,
  hostPath: string,
  run: RunDocker = runDocker,
): void {
  const imageId = run(["inspect", containerId, "--format", "{{.Image}}"]).trim();
  if (!imageId) {
    throw new Error(`docker inspect reported no image for container ${containerId}`);
  }

  // No command needed: every buildcage image defines an ENTRYPOINT.
  const scratchId = run(["create", imageId]).trim();
  try {
    run(["cp", `${scratchId}:${containerPath}`, hostPath]);
  } finally {
    try {
      run(["rm", "-f", scratchId]);
    } catch {
      // The copy is already done; don't fail the report over a leaked container.
    }
  }
}

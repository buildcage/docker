import { execFileSync } from "node:child_process";

import { describeDockerFailure } from "#core/lib/actions/docker-error.ts";
import type { RunDocker } from "#core/lib/docker/client.ts";

import { ReportError } from "./errors.ts";

// stderr is piped, not inherited, so describeDockerFailure can quote it.
//
// Untested by design: the default behind the seam below, which only hands
// execFileSync what the tested caller decided.
/* v8 ignore start */
const runDocker: RunDocker = (args) =>
  execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
/* v8 ignore stop */

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
  const imageId = step("docker inspect (resolving the builder's image)", () =>
    run(["inspect", containerId, "--format", "{{.Image}}"]).trim(),
  );
  if (!imageId) {
    throw new ReportError(
      `docker inspect reported no image for container ${containerId}`,
      "DOCKER_UNAVAILABLE",
    );
  }

  // No command needed: every buildcage image defines an ENTRYPOINT.
  const scratchId = step(
    "docker create (making a scratch container from the builder's image)",
    () => run(["create", imageId]).trim(),
  );
  try {
    step(`docker cp (fetching ${containerPath} from the builder image)`, () =>
      run(["cp", `${scratchId}:${containerPath}`, hostPath]),
    );
  } finally {
    try {
      run(["rm", "-f", scratchId]);
    } catch {
      // The copy is already done; don't fail the report over a leaked container.
    }
  }
}

/** Names the docker call in the error, so a failure of one step is not
 *  reported as a failure of another. */
function step<T>(operation: string, call: () => T): T {
  try {
    return call();
  } catch (e) {
    throw new ReportError(describeDockerFailure(e, { operation }), "DOCKER_UNAVAILABLE");
  }
}

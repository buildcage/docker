import type { SpawnCommand } from "./client.ts";

/** A `docker pull` left running while the caller gets on with something else. */
export interface ImagePull {
  /** Settles when the pull exits. Rejects with the `{status, stderr}` shape
   *  describeDockerFailure() (core/lib/actions/docker-error.ts) reads, or with
   *  Node's own error when docker could not be spawned. */
  finished: Promise<void>;
  /** Stops the pull if it is still running. The daemon abandons a pull once
   *  its client goes away, so no image is left behind. */
  cancel: () => void;
}

/** Starts `docker pull --quiet <imageRef>` in the background. */
export function startImagePull(imageRef: string, spawnDocker: SpawnCommand): ImagePull {
  const child = spawnDocker(["pull", "--quiet", imageRef]);

  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.stdout?.resume();

  const finished = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        Object.assign(
          new Error(
            `docker pull exited with code ${code}${signal ? ` (signal ${signal})` : ""}: ${stderr.trim()}`,
          ),
          { status: code ?? undefined, stderr },
        ),
      );
    });
  });
  // A step that fails before it waits for the pull never reads this result.
  finished.catch(() => {});

  return {
    finished,
    cancel: () => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    },
  };
}

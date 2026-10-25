import { existsSync } from "node:fs";

export interface DockerErrorLike {
  code?: string;
  status?: number;
  message?: string;
  stderr?: string;
}

interface DescribeDockerFailureOptions {
  operation?: string;
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
}

const REQUIREMENT =
  "Buildcage requires a working Docker installation (client and daemon) on the runner, on " +
  "Docker Engine 25.0 or later with Compose v2.20.2 or later. " +
  'Lightweight runner images such as GitHub-hosted "ubuntu-slim" ship a Docker client but no ' +
  'daemon and are not supported for this action. Use "ubuntu-latest", or another runner with a ' +
  "full Docker install, instead. See README.md and docs/security.md for details.";

export const SLIM_RUNNER_DETECTED_PREFIX =
  ' Detected a container-based GitHub-hosted runner image (e.g. "ubuntu-slim")';

const SLIM_RUNNER_NOTE = `${SLIM_RUNNER_DETECTED_PREFIX}: these ship a Docker client with no daemon and are not supported for this action.`;

/**
 * The stderr a caught child-process error carried, trimmed, or "" when it
 * carried none. Every message built from a failed spawn needs exactly this,
 * and the shape it has to reach through is the same each time.
 */
export function capturedStderr(e: unknown): string {
  const err = (e && typeof e === "object" ? e : {}) as DockerErrorLike;
  return typeof err.stderr === "string" ? err.stderr.trim() : "";
}

/**
 * Turns a caught `docker` invocation error into an actionable message,
 * pointing at the runner requirement instead of surfacing execFileSync's
 * opaque "Command failed: docker ...args..." text. Never echoes `e.message`.
 * Inherited stderr is already in the Actions log, so the message points back
 * to it; captured stderr (e.g. from a piped call) was seen nowhere, so it is
 * included.
 */
export function describeDockerFailure(
  e: unknown,
  {
    operation = "docker",
    env = process.env,
    exists = existsSync,
  }: DescribeDockerFailureOptions = {},
): string {
  const err = (e && typeof e === "object" ? e : {}) as DockerErrorLike;
  const slimNote = isLikelySlimRunner(env, exists) ? SLIM_RUNNER_NOTE : "";

  let whatHappened;
  if (err.code === "ENOENT") {
    whatHappened = `The "docker" command was not found on this runner's PATH while running ${operation}.`;
  } else {
    const captured = capturedStderr(e);
    const detail = captured
      ? `: ${captured}`
      : " (see the Docker output above for the underlying error)";
    whatHappened = `${operation} failed${detail}.`;
  }

  return `${whatHappened}${slimNote} ${REQUIREMENT}`;
}

/**
 * Best-effort detection of GitHub's container-based hosted runner images
 * (currently: ubuntu-slim), which run jobs inside a container rather than
 * a dedicated VM, so unlike VM-based ubuntu-latest/22.04/24.04/26.04 they
 * ship a Docker client with no daemon.
 *
 * Not an official/documented API: ImageOS is hardcoded to "Linux" (vs.
 * "ubuntu24" etc. on VM images) and /run/.containerenv is baked into the
 * image at build time by GitHub's own Dockerfile
 * (github.com/actions/runner-images/blob/main/images/ubuntu-slim/Dockerfile).
 * Both signals could change without notice, and failing to detect just falls
 * back to the generic message in describeDockerFailure, so this is safe to
 * get wrong.
 */
export function isLikelySlimRunner(
  _env: NodeJS.ProcessEnv = process.env,
  _exists: (path: string) => boolean = existsSync,
): boolean {
  return _env.ImageOS === "Linux" && _exists("/run/.containerenv");
}

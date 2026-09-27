import { execFileSync } from "node:child_process";

import { capturedStderr, describeDockerFailure } from "#core/lib/actions/docker-error.ts";
import { withLogGroup } from "#core/lib/actions/log.ts";
import { buildComposeLogsArgs } from "#core/lib/docker/args.ts";
import type { RunDocker } from "#core/lib/docker/client.ts";
import {
  buildDockerInspectStateArgs,
  parseContainerState,
  describeContainerStartFailure,
  type ContainerState,
} from "#core/lib/docker/health.ts";

import { SetupError } from "./errors.ts";

/** Lines of container log printed when the builder fails to come up. */
const LOG_TAIL = 100;

/** `captureDocker`/`printDocker` are injectable so tests can assert on argv
 *  instead of mocking node:child_process directly (see core/lib/docker/client.ts). */
export interface BuilderDiagnosticsDeps {
  /** `docker <args>` with stdout captured, for output this module reads. */
  captureDocker?: RunDocker;
  /** `docker <args>` with stdio inherited, for output meant for the job log. */
  printDocker?: (args: string[], env: NodeJS.ProcessEnv) => void;
}

// Untested by design: the defaults behind the seams above, which only hand
// execFileSync what the tested callers decided.
/* v8 ignore start */
const captureDockerViaExec: RunDocker = (args, env) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    env,
    // Captured, not inherited: no container is the expected outcome here,
    // and the daemon's "no such object" would read as the cause.
    stdio: ["ignore", "pipe", "pipe"],
  });

const printDockerViaExec = (args: string[], env: NodeJS.ProcessEnv): void => {
  execFileSync("docker", args, { stdio: "inherit", env });
};
/* v8 ignore stop */

export interface BuilderStartErrorOptions {
  composeFile: string;
  projectName: string;
  builderName: string;
  composeEnv: NodeJS.ProcessEnv;
}

/** Asks the container itself why `compose up` failed. With no container to
 *  ask, the failure predates it and is Docker's own. */
export function builderStartError(
  e: unknown,
  { composeFile, projectName, builderName, composeEnv }: BuilderStartErrorOptions,
  deps: BuilderDiagnosticsDeps = {},
): SetupError {
  const state = readBuilderState(builderName, composeEnv, deps);
  if (!state) {
    return new SetupError(
      describeDockerFailure(e, { operation: "docker compose up" }),
      "DOCKER_UNAVAILABLE",
    );
  }

  printBuilderLog({ composeFile, projectName, composeEnv }, deps);
  return new SetupError(
    describeContainerStartFailure(state, { role: "builder", containerName: builderName }),
    "BUILDER_NOT_READY",
  );
}

function readBuilderState(
  builderName: string,
  composeEnv: NodeJS.ProcessEnv,
  { captureDocker = captureDockerViaExec }: BuilderDiagnosticsDeps,
): ContainerState | null {
  try {
    return parseContainerState(captureDocker(buildDockerInspectStateArgs(builderName), composeEnv));
  } catch (e) {
    reportInspectFailure(e);
    return null;
  }
}

/** Anything other than the expected missing container is worth seeing, even
 *  though the compose failure is what gets reported. */
function reportInspectFailure(e: unknown): void {
  const stderr = capturedStderr(e);
  if (stderr && !/no such object/i.test(stderr)) {
    console.log(`buildcage: could not read the builder container's state: ${stderr}`);
  }
}

/** Best effort: the message that follows still stands without the log. */
function printBuilderLog(
  { composeFile, projectName, composeEnv }: Omit<BuilderStartErrorOptions, "builderName">,
  { printDocker = printDockerViaExec }: BuilderDiagnosticsDeps,
): void {
  withLogGroup("buildcage: Builder container log", () => {
    try {
      printDocker(buildComposeLogsArgs({ composeFile, projectName, tail: LOG_TAIL }), composeEnv);
    } catch {
      console.log("The builder container's log could not be read.");
    }
  });
}

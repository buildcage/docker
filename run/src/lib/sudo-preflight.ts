import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import { SandboxError } from "./errors.ts";
import {
  SLIM_RUNNER_DETECTED_PREFIX,
  isLikelySlimRunner,
  type DockerErrorLike,
} from "#core/lib/actions/docker-error.ts";

const REQUIREMENT =
  "The run action requires a Linux runner with passwordless sudo for the isolation setup itself " +
  '(network namespace, veth, iptables) — this is the default on GitHub-hosted "ubuntu-*" runners, ' +
  'but NOT on lightweight images such as "ubuntu-slim" or many self-hosted/minimal runners. See ' +
  "docs/reference.md and docs/security.md for details.";

const SLIM_RUNNER_NOTE = `${SLIM_RUNNER_DETECTED_PREFIX} — these typically don't have passwordless sudo configured for this kind of privileged setup.`;

/**
 * Kept pure (takes the error, not execFileSync's raw output) so it's
 * unit-testable the same way as core/lib/actions/docker-error.ts's
 * describeDockerFailure.
 */
export interface DescribeSudoFailureOptions {
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
}

export function describeSudoFailure(
  e: unknown,
  { env = process.env, exists = existsSync }: DescribeSudoFailureOptions = {},
): string {
  const err = (e && typeof e === "object" ? e : {}) as DockerErrorLike;
  const captured = typeof err.stderr === "string" ? err.stderr.trim() : "";
  const slimNote = isLikelySlimRunner(env, exists) ? SLIM_RUNNER_NOTE : "";
  return `'sudo' is not available without a password on this runner.${slimNote} ${REQUIREMENT}${captured ? ` (${captured})` : ""}`;
}

/**
 * Fails fast, before spinning up the proxy container, so a missing
 * passwordless-sudo setup is never misattributed to the user's own `run:`
 * command failing. Only covers the general case: a sudoers config scoped to
 * a specific command (rather than blanket NOPASSWD:ALL) can pass this probe
 * yet still fail runIsolated()'s later, differently-shaped invocation.
 */
export function checkPasswordlessSudo(): void {
  try {
    execFileSync("sudo", ["-n", "true"], { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] });
  } catch (e) {
    throw new SandboxError(describeSudoFailure(e), "PASSWORDLESS_SUDO_REQUIRED");
  }
}

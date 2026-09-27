import { execFileSync } from "node:child_process";

import { errorMessage } from "#core/lib/errors.ts";

import { ReportError } from "./errors.ts";

/** Narrowed to what this module needs, so a test can assert on argv and env. */
export type RunNode = (args: string[], env: NodeJS.ProcessEnv) => void;

// Untested by design: the default behind the seam above, which only hands
// execFileSync what the tested caller decided.
/* v8 ignore start */
const runNode: RunNode = (args, env) => {
  execFileSync("node", args, { stdio: "inherit", env });
};
/* v8 ignore stop */

export interface RunReportScriptOptions {
  /** Where report-action.js should write the traffic JSON, when one is wanted. */
  trafficFile?: string;
  env?: NodeJS.ProcessEnv;
  run?: RunNode;
}

/**
 * Runs report-action.js with stdio inherited and returns the exit status this
 * step should reproduce as its own. It owns everything downstream, down to the
 * fail_on_blocked exit decision, and explains any failure of its own through
 * the stdio it inherited.
 *
 * @throws {ReportError} REPORT_SCRIPT_FAILED when it never ran to completion,
 * which leaves nobody to explain why.
 */
export function runReportScript(
  scriptPath: string,
  containerId: string,
  { trafficFile, env = process.env, run = runNode }: RunReportScriptOptions = {},
): number {
  // Set or removed, never inherited: an earlier step can put it in the runner's
  // environment through GITHUB_ENV.
  const { BUILDCAGE_TRAFFIC_FILE: _inherited, ...rest } = env;
  try {
    run(
      [scriptPath, containerId],
      trafficFile ? { ...rest, BUILDCAGE_TRAFFIC_FILE: trafficFile } : rest,
    );
  } catch (e) {
    const status = (e as { status?: number | null }).status;
    if (typeof status !== "number") {
      throw new ReportError(
        `Failed to run report-action.js: ${errorMessage(e)}`,
        "REPORT_SCRIPT_FAILED",
      );
    }
    return status;
  }
  return 0;
}

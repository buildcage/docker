import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describeDockerFailure } from "../../core/lib/actions/docker-error.ts";
import { deriveProjectName, buildDockerCpArgs } from "../../core/lib/docker/container.ts";
import { ActionError } from "../../core/lib/general/action-error.ts";
import { errorMessage } from "../../core/lib/general/error-message.ts";
import { ReportError } from "./lib/errors.ts";

/**
 * `docker ps --format '{{.ID}}'` prints one ID per line, possibly with
 * trailing blank lines — exported for unit testing without a real daemon.
 */
export function parseContainerIds(psOutput: string): string[] {
  return psOutput
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main(): Promise<void> {
  const builderName = process.env.INPUT_BUILDER_NAME || "buildcage";
  // Same derivation setup uses for its own `-p` — see
  // core/lib/docker/container.ts's deriveProjectName. Matching it here,
  // independently, is what lets this step find the right container without
  // ever touching setup's compose file (or even knowing it exists).
  const projectName = deriveProjectName(builderName);

  // 1. Locate the report-source container purely via Docker metadata.
  let containerId: string;
  try {
    const psOutput = execFileSync(
      "docker",
      [
        "ps",
        "--filter", `label=com.docker.compose.project=${projectName}`,
        "--filter", "label=io.github.dash14.buildcage.report-source=true",
        "--format", "{{.ID}}",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const ids = parseContainerIds(psOutput);
    if (ids.length !== 1) {
      throw new ReportError(
        `Expected exactly one buildcage container for builder_name ${JSON.stringify(builderName)}, found ${ids.length}. ` +
          "Did the setup step run first, with the same builder_name?",
        "CONTAINER_NOT_FOUND",
      );
    }
    containerId = ids[0];
  } catch (e) {
    if (e instanceof ReportError) throw e;
    throw new ReportError(describeDockerFailure(e, { operation: "docker ps" }), "DOCKER_UNAVAILABLE");
  }

  // 2. Pull report.sh out of the (Sigstore-verified) image and run it,
  // inheriting stdio so it can write logs/annotations directly. report.sh
  // owns everything downstream of report.js's JSON — parsing it, writing
  // the Job Summary, printing logs, and the fail_on_blocked exit decision
  // (see its own header comment) — so this step's only job is to reproduce
  // report.sh's own exit code as its own. That JSON's shape is never a
  // contract this action's own code depends on, so a report.js change
  // alone can never cause a version-skew failure here.
  const scratchDir = mkdtempSync(join(tmpdir(), "buildcage-report-"));
  try {
    const reportScriptPath = join(scratchDir, "report.sh");

    // `docker cp` failing is a genuine Docker/runner problem — same
    // diagnosis as the container-lookup step above.
    try {
      execFileSync(
        "docker",
        buildDockerCpArgs({
          containerName: containerId,
          containerPath: "/opt/buildcage/scripts/report.sh",
          hostPath: reportScriptPath,
        }),
        { stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (e) {
      throw new ReportError(
        describeDockerFailure(e, { operation: "docker cp (fetching report.sh from the container)" }),
        "DOCKER_UNAVAILABLE",
      );
    }

    try {
      chmodSync(reportScriptPath, 0o700);
      execFileSync(reportScriptPath, [containerId], { stdio: "inherit" });
    } catch (e) {
      // A numeric exit status means report.sh ran and has already explained
      // itself (via its own ::error::/stderr output, visible through the
      // inherited stdio above) — just reproduce it. Anything else (e.g.
      // ENOENT) means we couldn't even launch it, which is our own problem
      // to report.
      const status = (e as { status?: number | null }).status;
      if (typeof status === "number") {
        process.exitCode = status;
        return;
      }
      throw new ReportError(`Failed to run report.sh: ${errorMessage(e)}`, "REPORT_SCRIPT_FAILED");
    }
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    if (err instanceof ActionError) {
      console.log(`::error::${err.message}`);
    } else {
      console.log(`::error::Unexpected error in report: ${errorMessage(err)}`);
    }
    process.exit(1);
  });
}

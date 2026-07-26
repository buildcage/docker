import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describeDockerFailure } from "../../core/lib/actions/docker-error.ts";
import { deriveProjectName } from "../../core/lib/docker/container.ts";
import { createDocker } from "../../core/lib/docker/client.ts";
import { ActionError } from "../../core/lib/general/action-error.ts";
import { errorMessage } from "../../core/lib/general/error-message.ts";
import { ReportError } from "./lib/errors.ts";

async function main(): Promise<void> {
  const builderName = process.env.INPUT_BUILDER_NAME || "buildcage";
  // Same derivation setup uses for its own `-p` — see
  // core/lib/docker/container.ts's deriveProjectName. Matching it here,
  // independently, is what lets this step find the right container without
  // ever touching setup's compose file (or even knowing it exists).
  const projectName = deriveProjectName(builderName);
  const docker = createDocker();

  // 1. Locate the report-source container purely via Docker metadata.
  let containerId: string;
  try {
    const ids = docker.findContainers([
      `label=com.docker.compose.project=${projectName}`,
      "label=io.github.dash14.buildcage.report-source=true",
    ]);
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

  // 2. Pull report-action.js out of the (Sigstore-verified) image and run
  // it with node, inheriting stdio so it can write logs/annotations
  // directly. report-action.js owns everything downstream — fetching the
  // container's own env/logs, rendering the Job Summary, and the
  // fail_on_blocked exit decision — so this step's only job is to
  // reproduce its exit code as its own. None of that ever crosses this
  // process as JSON, so a report-action.js change alone can never cause a
  // version-skew failure here.
  const scratchDir = mkdtempSync(join(tmpdir(), "buildcage-report-"));
  try {
    const reportActionPath = join(scratchDir, "report-action.js");

    // `docker cp` failing is a genuine Docker/runner problem — same
    // diagnosis as the container-lookup step above.
    try {
      docker.copyFromContainer(containerId, "/opt/buildcage/scripts/report-action.js", reportActionPath);
    } catch (e) {
      throw new ReportError(
        describeDockerFailure(e, { operation: "docker cp (fetching report-action.js from the container)" }),
        "DOCKER_UNAVAILABLE",
      );
    }

    // Anything past this point is report-action.js's own problem (or ours
    // in preparing to run it) rather than "Docker isn't set up on this
    // runner" — keeping it a separate catch means the error the user sees
    // names the actual failure instead of a misleading "Docker isn't
    // installed" message.
    try {
      execFileSync("node", [reportActionPath, containerId], { stdio: "inherit" });
    } catch (e) {
      // A numeric exit status means report-action.js ran and has already
      // explained itself (via its own ::error::/stderr output, visible
      // through the inherited stdio above) — just reproduce it. Anything
      // else (e.g. ENOENT) means we couldn't even launch it, which is our
      // own problem to report.
      const status = (e as { status?: number | null }).status;
      if (typeof status === "number") {
        process.exitCode = status;
        return;
      }
      throw new ReportError(`Failed to run report-action.js: ${errorMessage(e)}`, "REPORT_SCRIPT_FAILED");
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

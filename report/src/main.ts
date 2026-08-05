import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@actions/core";

import { describeDockerFailure } from "../../core/lib/actions/docker-error.ts";
import { deriveProjectName } from "../../core/lib/docker/container.ts";
import { createDocker } from "../../core/lib/docker/client.ts";
import {
  REPORT_ACTION_SCRIPT_PATH,
  REPORT_SOURCE_LABEL,
} from "../../core/lib/docker/report-source.ts";
import { ActionError } from "../../core/lib/general/action-error.ts";
import { errorMessage } from "../../core/lib/general/error-message.ts";
import { ReportError } from "./lib/errors.ts";

// CI-only override gate, mirrors setup/src/main.ts's LOCAL_IMAGE_OVERRIDE_ENABLED.
const PROJECT_NAME_OVERRIDE_ENABLED = process.env.BUILDCAGE_BUILD_TEST_HOOKS === "1";

// Same derivation setup uses for its `-p`.
export function resolveProjectName(builderName: string, env: NodeJS.ProcessEnv): string {
  if (PROJECT_NAME_OVERRIDE_ENABLED && env.COMPOSE_PROJECT_NAME) {
    return env.COMPOSE_PROJECT_NAME;
  }
  return deriveProjectName(builderName);
}

async function main(): Promise<void> {
  const builderName = core.getInput("builder_name") || "buildcage";
  const projectName = resolveProjectName(builderName, process.env);
  const docker = createDocker();

  // 1. Locate the report-source container purely via Docker metadata.
  let containerId: string;
  try {
    const ids = docker.findContainers([
      `label=com.docker.compose.project=${projectName}`,
      `label=${REPORT_SOURCE_LABEL}=true`,
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
    throw new ReportError(
      describeDockerFailure(e, { operation: "docker ps" }),
      "DOCKER_UNAVAILABLE",
    );
  }

  // 2. Pull report-action.js out of the (Sigstore-verified) image and run
  // it with node, inheriting stdio. It owns everything downstream —
  // fetching the container's env/logs, rendering the Job Summary, the
  // fail_on_blocked exit decision — so this step just reproduces its exit
  // code as its own.
  const scratchDir = mkdtempSync(join(tmpdir(), "buildcage-report-"));
  try {
    const reportActionPath = join(scratchDir, "report-action.js");

    try {
      docker.copyFromContainer(containerId, REPORT_ACTION_SCRIPT_PATH, reportActionPath);
    } catch (e) {
      throw new ReportError(
        describeDockerFailure(e, {
          operation: "docker cp (fetching report-action.js from the container)",
        }),
        "DOCKER_UNAVAILABLE",
      );
    }

    // A separate catch from the docker cp above, so the error the user
    // sees names the actual failure instead of a misleading Docker message.
    try {
      execFileSync("node", [reportActionPath, containerId], { stdio: "inherit" });
    } catch (e) {
      // A numeric exit status means report-action.js ran and already
      // explained itself via its own inherited stdio — just reproduce it.
      const status = (e as { status?: number | null }).status;
      if (typeof status === "number") {
        process.exitCode = status;
        return;
      }
      throw new ReportError(
        `Failed to run report-action.js: ${errorMessage(e)}`,
        "REPORT_SCRIPT_FAILED",
      );
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

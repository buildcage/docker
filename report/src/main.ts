import { execFileSync } from "node:child_process";
import { appendFileSync, chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createAnnotation } from "../../core/lib/actions/annotation.ts";
import { describeDockerFailure } from "../../core/lib/actions/docker-error.ts";
import { deriveProjectName, buildDockerCpArgs } from "../../core/lib/docker/container.ts";
import { ActionError } from "../../core/lib/general/action-error.ts";
import { errorMessage } from "../../core/lib/general/error-message.ts";
import { ReportError } from "./lib/errors.ts";

/**
 * report.sh/report.js's JSON contract — see
 * setup/docker/{transparent,explicit}/files/report.sh and
 * core/scripts/report.ts. `stepSummary` already has
 * {{GITHUB_ACTION_REPOSITORY}}/{{GITHUB_ACTION_REF}} substituted by
 * report.sh; `blocked`/`message` are absent when there's nothing to report
 * (audit mode never sets `blocked` at all — it never fails regardless of
 * blocked connections).
 */
export interface ReportResult {
  mode: string | null;
  blocked?: boolean;
  message?: string;
  stepSummary: string;
  rawLog?: string;
}

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

/**
 * Audit mode never fails regardless of blocked connections — `blocked` is
 * only ever set (see core/scripts/report.ts) when mode is "restrict".
 */
export function shouldFailOnBlocked(report: Pick<ReportResult, "mode" | "blocked">, failOnBlocked: boolean): boolean {
  return report.mode === "restrict" && report.blocked === true && failOnBlocked;
}

async function main(): Promise<void> {
  const builderName = process.env.INPUT_BUILDER_NAME || "buildcage";
  // Same derivation setup uses for its own `-p` — see
  // core/lib/docker/container.ts's deriveProjectName. Matching it here,
  // independently, is what lets this step find the right container without
  // ever touching setup's compose file (or even knowing it exists).
  const projectName = deriveProjectName(builderName);

  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  const annotation = createAnnotation(Boolean(summaryFile));

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

  // 2. Pull report.sh out of the (Sigstore-verified) image and run it —
  // fetched fresh from the running container every time, never staged
  // anywhere on the runner between invocations (see report.sh's own header
  // comment for why). It reaches back into the container itself via
  // `docker exec` to gather whatever this engine's version needs.
  const scratchDir = mkdtempSync(join(tmpdir(), "buildcage-report-"));
  let jsonOutput: string;
  try {
    const reportScriptPath = join(scratchDir, "report.sh");
    execFileSync(
      "docker",
      buildDockerCpArgs({
        containerName: containerId,
        containerPath: "/opt/buildcage/scripts/report.sh",
        hostPath: reportScriptPath,
      }),
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    chmodSync(reportScriptPath, 0o700);

    jsonOutput = execFileSync(reportScriptPath, [containerId], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    throw new ReportError(
      describeDockerFailure(e, { operation: "fetching the report from the container" }),
      "DOCKER_UNAVAILABLE",
    );
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }

  const report = JSON.parse(jsonOutput) as ReportResult;

  // 3. Console output — raw log lines, unchanged from before this redesign.
  if (report.rawLog) {
    console.log("::group::HTTP Proxy communication logs");
    process.stdout.write(report.rawLog);
    console.log("::endgroup::");
    console.log();
  }

  // 4. Write Job Summary — report.sh already rendered the full markdown.
  if (summaryFile) {
    appendFileSync(summaryFile, report.stepSummary);
  } else {
    console.log(report.stepSummary);
  }

  if (report.mode === null) {
    process.exit(0);
  }

  // 5. Error control for blocked connections.
  const failOnBlocked = (process.env.INPUT_FAIL_ON_BLOCKED || "true").toLowerCase() === "true";
  if (report.message) {
    if (shouldFailOnBlocked(report, failOnBlocked)) {
      annotation.error(report.message);
      process.exitCode = 1;
    } else {
      annotation.notice(report.message);
    }
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

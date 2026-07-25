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
 * core/scripts/report.ts. `stepSummary` still contains report.js's
 * unsubstituted {{GITHUB_ACTION_REPOSITORY}}/{{GITHUB_ACTION_REF}}
 * placeholders — see substituteActionPlaceholders below. `blocked` is only
 * ever present when mode is "restrict" (audit mode never fails regardless
 * of blocked connections); `message` is present whenever there's a blocked
 * connection to report, audit or restrict. `logs` (see
 * core/lib/log/log-entries.ts) is printed one entry at a time via
 * console[level] below — unrecognized levels fall back to console.log so
 * an older report build stays usable against a newer report.js.
 */
export interface ReportResult {
  mode: string | null;
  blocked?: boolean;
  message?: string;
  stepSummary: string;
  logs?: { level: string; log: string }[];
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

/**
 * Maps a LogEntry's level (see core/lib/log/log-entries.ts) to the console
 * method that prints it. Unrecognized levels fall back to "log" so an older
 * report build stays usable against a newer report.js.
 */
export function consoleMethodForLevel(level: string): "log" | "debug" | "warn" | "error" {
  switch (level) {
    case "debug":
      return "debug";
    case "warning":
      return "warn";
    case "error":
      return "error";
    default:
      return "log";
  }
}

/**
 * report.js can't know its own actionRepo/actionRef (those only exist in
 * the `report` action step's own GitHub Actions runtime, not inside the
 * container), so it leaves these two placeholders in stepSummary instead.
 * Substituting them here in JS, scoped to just the stepSummary string
 * (never logs, never the raw JSON text), means: no shell quoting/sed
 * delimiter concerns with ref/repo values, and proxy-log content a build
 * step could influence — which flows into logs and stepSummary's own
 * host/URL tables — is never in scope for the substitution to begin with.
 */
export function substituteActionPlaceholders(stepSummary: string, env: NodeJS.ProcessEnv): string {
  return stepSummary
    .replaceAll("{{GITHUB_ACTION_REPOSITORY}}", env.GITHUB_ACTION_REPOSITORY || "")
    .replaceAll("{{GITHUB_ACTION_REF}}", env.GITHUB_ACTION_REF || "");
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

    // Anything past this point is report.sh's own problem (or ours in
    // preparing to run it) rather than "Docker isn't set up on this
    // runner" — keeping it a separate catch means the error the user sees
    // names the actual failure (report.sh's captured stderr, which
    // includes whatever the in-container report.js itself failed with)
    // instead of a misleading "Docker isn't installed" message.
    try {
      chmodSync(reportScriptPath, 0o700);
      jsonOutput = execFileSync(reportScriptPath, [containerId], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      const stderr = typeof (e as { stderr?: unknown }).stderr === "string" ? (e as { stderr: string }).stderr.trim() : "";
      throw new ReportError(
        `report.sh failed${stderr ? `: ${stderr}` : ` (${errorMessage(e)})`}`,
        "REPORT_SCRIPT_FAILED",
      );
    }
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }

  const report = JSON.parse(jsonOutput) as ReportResult;
  report.stepSummary = substituteActionPlaceholders(report.stepSummary, process.env);

  // 3. Console output — one entry at a time, at its own level.
  for (const entry of report.logs ?? []) {
    console[consoleMethodForLevel(entry.level)](entry.log);
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

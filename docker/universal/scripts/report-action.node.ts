/**
 * Generates and emits the universal engine's outbound-traffic report.
 * Baked into the image, fetched fresh via `docker cp` by the `report`
 * action on every run (never staged on the runner — see report/src/main.ts)
 * and run with `node report-action.js <container-id>`. Runs on the runner,
 * not inside the container, reaching in via core/lib/docker/client.ts —
 * so `report` itself never needs to know this engine's log path or env
 * var names.
 */
import * as core from "@actions/core";
import { createDocker } from "#core/lib/docker/client.ts";
import { readRotatedLog } from "#core/lib/docker/rotated-log.ts";
import { buildReportParameters } from "#core/lib/report/parameters.ts";
import { buildUniversalReportData } from "#core/lib/report/build/universal.ts";
import { renderReportMarkdown } from "#core/lib/report/render/render-report-markdown.ts";
import { emitBlockedOutcome } from "#core/lib/report/outcome/emit.ts";
import { errorMessage } from "#core/lib/errors.ts";
import { writeStepSummary } from "../../lib/write-step-summary.ts";
import { readActionVersion } from "../../lib/read-action-version.ts";

const LOG_DIR = "/var/log/haproxy";

async function main(): Promise<void> {
  const containerId = process.argv[2];
  if (!containerId) {
    throw new Error("Usage: report-action.js <container-id>");
  }

  const docker = createDocker();
  const parameters = buildReportParameters(docker.readEnv(containerId));
  const report = await buildUniversalReportData(
    readRotatedLog(docker, containerId, LOG_DIR),
    parameters,
  );

  const markdown = renderReportMarkdown(
    report,
    process.env.GITHUB_ACTION_REPOSITORY || "buildcage/docker",
    process.env.GITHUB_ACTION_REF || "v2",
    { actionVersion: readActionVersion(docker, containerId, "universal") },
  );

  await writeStepSummary(markdown);

  // Several test/dev invocations run this script directly without setting
  // fail_on_blocked, unlike the real `report` action where action.yml's
  // own default always supplies it — fall back to that same default.
  let failOnBlocked: boolean;
  try {
    failOnBlocked = core.getBooleanInput("fail_on_blocked");
  } catch {
    failOnBlocked = true;
  }
  emitBlockedOutcome(report, { failOnBlocked, summaryFile: process.env.GITHUB_STEP_SUMMARY });
}

main().catch((e) => {
  console.log(`::error::Unexpected error in report-action: ${errorMessage(e)}`);
  process.exit(1);
});

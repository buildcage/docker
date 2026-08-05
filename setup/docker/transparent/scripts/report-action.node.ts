/**
 * Generates and emits the transparent engine's outbound-traffic report.
 * Baked into the image, fetched fresh via `docker cp` by the `report`
 * action on every run (never staged on the runner — see report/src/main.ts)
 * and run with `node report-action.js <container-id>`. Runs on the runner,
 * not inside the container, reaching in via core/lib/docker/client.ts —
 * so `report` itself never needs to know this engine's log path or env
 * var names.
 */
import * as core from "@actions/core";
import { createDocker } from "../../../../core/lib/docker/client.ts";
import { buildReportParameters } from "../../../../core/lib/report/parameters.ts";
import { buildTransparentReportData } from "../../../../core/lib/report/build/transparent.ts";
import { renderReportMarkdown } from "../../../../core/lib/report/render/render-report-markdown.ts";
import { emitBlockedOutcome } from "../../../../core/lib/report/outcome/emit-blocked-outcome.ts";
import { errorMessage } from "../../../../core/lib/general/error-message.ts";
import { writeStepSummary } from "../../lib/write-step-summary.ts";

const LOG_FILE = "/var/log/haproxy/current";

async function main(): Promise<void> {
  const containerId = process.argv[2];
  if (!containerId) {
    throw new Error("Usage: report-action.js <container-id>");
  }

  const docker = createDocker();
  const parameters = buildReportParameters(docker.readEnv(containerId));
  const report = await buildTransparentReportData(
    docker.readFileLines(containerId, LOG_FILE),
    parameters,
  );

  const markdown = renderReportMarkdown(
    report,
    process.env.GITHUB_ACTION_REPOSITORY || "dash14/buildcage",
    process.env.GITHUB_ACTION_REF || "v2",
    { title: "Outbound Traffic Report during Docker Build" },
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

/**
 * Generates and emits the transparent engine's outbound-traffic report.
 * Baked into the image, fetched fresh via `docker cp` by the `report`
 * action on every run (never staged on the runner — see report/src/main.ts)
 * and run with `node report-action.js <container-id>`. Runs on the runner,
 * not inside the container, reaching in via core/lib/docker/client.ts —
 * so `report` itself never needs to know this engine's log path or env
 * var names.
 */
import { appendFileSync } from "node:fs";
import { createDocker } from "../../../../core/lib/docker/client.ts";
import { buildReportParameters } from "../../../../core/lib/report/report-parameters.ts";
import { buildTransparentReportData } from "../../../../core/lib/report/build-transparent-report-data.ts";
import { renderReportMarkdown } from "../../../../core/lib/report/render-report-markdown.ts";
import { emitBlockedOutcome } from "../../../../core/lib/report/emit-blocked-outcome.ts";
import { errorMessage } from "../../../../core/lib/general/error-message.ts";

const LOG_FILE = "/var/log/haproxy/current";

async function main(): Promise<void> {
  const containerId = process.argv[2];
  if (!containerId) {
    throw new Error("Usage: report-action.js <container-id>");
  }

  const docker = createDocker();
  const parameters = buildReportParameters(docker.readEnv(containerId));
  const report = await buildTransparentReportData(docker.readFileLines(containerId, LOG_FILE), parameters);

  const markdown = renderReportMarkdown(
    report,
    process.env.GITHUB_ACTION_REPOSITORY || "dash14/buildcage",
    process.env.GITHUB_ACTION_REF || "v2",
  );

  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    appendFileSync(summaryFile, markdown);
  } else {
    console.log(markdown);
  }

  const failOnBlocked = (process.env.INPUT_FAIL_ON_BLOCKED || "true").toLowerCase() === "true";
  emitBlockedOutcome(report, { failOnBlocked, summaryFile });
}

main().catch((e) => {
  console.log(`::error::Unexpected error in report-action: ${errorMessage(e)}`);
  process.exit(1);
});

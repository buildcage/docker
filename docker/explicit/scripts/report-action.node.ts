/**
 * Generates and emits the explicit engine's outbound-traffic report.
 * Baked into the image, fetched fresh via `docker cp` by the `report`
 * action on every run (never staged on the runner — see report/src/main.ts)
 * and run with `node report-action.js <container-id>`. Runs on the runner,
 * not inside the container, reaching in via core/lib/docker/client.ts —
 * including `buildctl` itself, run inside the container via `docker exec`
 * rather than needing buildctl reachable from the runner.
 */
import * as core from "@actions/core";
import { createDocker, type Docker } from "#core/lib/docker/client.ts";
import { buildReportParameters } from "#core/lib/report/parameters.ts";
import { buildExplicitReportData } from "#core/lib/report/build/explicit.ts";
import { renderReportMarkdown } from "#core/lib/report/render/render-report-markdown.ts";
import { renderCommunicationDetailsBody } from "#core/lib/report/render/communication-details.ts";
import { emitBlockedOutcome } from "#core/lib/report/outcome/emit.ts";
import { errorMessage } from "#core/lib/errors.ts";
import { wrapLogGroup } from "#core/lib/actions/log.ts";
import { writeStepSummary } from "../../lib/write-step-summary.ts";
import { readActionVersion } from "../../lib/read-action-version.ts";
import { selectAllRefs } from "#core/lib/log/build-histories.ts";
import { parseVertexAllowedLog, type VertexAllowedEntry } from "#core/lib/log/vertex.ts";

const LOG_FILE = "/var/log/buildkitd/current";

/** Every build since the container started, not just the latest — a
 *  workflow may run several before calling report once. Best-effort: a
 *  buildctl failure here leaves the per-command breakdown empty. */
function collectBuilds(docker: Docker, containerId: string): VertexAllowedEntry[][] {
  try {
    const historiesOutput = docker.exec(containerId, [
      "buildctl",
      "debug",
      "histories",
      "--format",
      "{{json .}}",
    ]);
    const refs = selectAllRefs(historiesOutput);
    return refs.map((ref) => {
      const rawJsonOutput = docker.exec(containerId, [
        "buildctl",
        "debug",
        "logs",
        "--progress=rawjson",
        ref,
      ]);
      return parseVertexAllowedLog(rawJsonOutput);
    });
  } catch (e) {
    console.error(
      `(failed to fetch allowed/audited traffic detail via buildctl: ${errorMessage(e)})`,
    );
    return [];
  }
}

async function main(): Promise<void> {
  const containerId = process.argv[2];
  if (!containerId) {
    throw new Error("Usage: report-action.js <container-id>");
  }

  const docker = createDocker();
  const parameters = buildReportParameters(docker.readEnv(containerId));
  const builds = collectBuilds(docker, containerId);
  const report = await buildExplicitReportData(
    docker.readFileLines(containerId, LOG_FILE),
    builds,
    parameters,
  );

  for (const line of wrapLogGroup(
    "HTTP Proxy communication logs",
    renderCommunicationDetailsBody(report.proxyLogs.builds, report.proxyLogs.denied),
  )) {
    console.log(line);
  }

  const markdown = renderReportMarkdown(
    report,
    process.env.GITHUB_ACTION_REPOSITORY || "buildcage/docker",
    process.env.GITHUB_ACTION_REF || "v2",
    { actionVersion: readActionVersion(docker, containerId, "explicit") },
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

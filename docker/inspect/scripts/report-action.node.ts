/**
 * Generates and emits the inspect engine's outbound-traffic report.
 *
 * Baked into the image and fetched via `docker cp` by the `report` action,
 * which runs it on the runner as `node report-action.js <container-id>` (see
 * report/src/main.ts). Reads two logs: the proxy's requests and the resolver's
 * refused names, the latter being the only trace of a DNS-only exfiltration.
 */
import * as core from "@actions/core";
import { createDocker } from "#core/lib/docker/client.ts";
import { buildReportParameters } from "#core/lib/report/parameters.ts";
import { buildInspectReportData } from "#core/lib/report/build/inspect.ts";
import { renderReportMarkdown } from "#core/lib/report/render/render-report-markdown.ts";
import { renderInspectDetailsBody } from "#core/lib/report/render/inspect-details.ts";
import { emitBlockedOutcome } from "#core/lib/report/outcome/emit.ts";
import { writeTrafficFile, buildTrafficRecords } from "#core/lib/report/outcome/traffic-output.ts";
import { errorMessage } from "#core/lib/errors.ts";
import { wrapLogGroup } from "#core/lib/actions/log.ts";
import { writeStepSummary } from "../../lib/write-step-summary.ts";

const PROXY_LOG = "/var/log/haproxy/current";
const RESOLVER_LOG = "/var/log/coredns/current";

async function main(): Promise<void> {
  const containerId = process.argv[2];
  if (!containerId) {
    throw new Error("Usage: report-action.js <container-id>");
  }

  const docker = createDocker();
  const parameters = buildReportParameters(docker.readEnv(containerId));
  const report = await buildInspectReportData(
    docker.readFileLines(containerId, PROXY_LOG),
    docker.readFileLines(containerId, RESOLVER_LOG),
    parameters,
  );

  for (const line of wrapLogGroup(
    "HTTP Proxy communication logs",
    renderInspectDetailsBody(report.timeline, report.startedAt),
  )) {
    console.log(line);
  }

  const markdown = renderReportMarkdown(
    report,
    process.env.GITHUB_ACTION_REPOSITORY || "buildcage/docker",
    process.env.GITHUB_ACTION_REF || "v2",
  );

  // The report action uploads this file as an artifact if asked; the upload
  // client is large and needs the runner's credentials, so it stays out of the
  // image and the file is just written here. Known before the summary is
  // written, so a truncated Communication details section can say whether the
  // full list is available as an artifact.
  const trafficFile = process.env.BUILDCAGE_TRAFFIC_FILE;
  await writeStepSummary(markdown, trafficFile !== undefined);

  if (trafficFile) {
    writeTrafficFile(trafficFile, buildTrafficRecords(report.timeline, report.startedAt));
  }

  // Falls back to action.yml's own default for direct test/dev invocations.
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

/**
 * Generates and emits the explicit engine's outbound-traffic report.
 * Baked into the image, fetched fresh via `docker cp` by the `report`
 * action on every run (never staged on the runner — see report/src/main.ts)
 * and run with `node report-action.js <container-id>`. Runs on the runner,
 * not inside the container, reaching in via core/lib/docker/client.ts —
 * including `buildctl` itself, run inside the container via `docker exec`
 * rather than needing buildctl reachable from the runner.
 */
import { appendFileSync } from "node:fs";
import { createDocker, type Docker } from "../../../../core/lib/docker/client.ts";
import { buildReportParameters } from "../../../../core/lib/report/report-parameters.ts";
import { buildExplicitReportData } from "../../../../core/lib/report/build-explicit-report-data.ts";
import { renderReportMarkdown } from "../../../../core/lib/report/render-report-markdown.ts";
import { renderCommunicationDetails } from "../../../../core/lib/report/command-log.ts";
import { emitBlockedOutcome } from "../../../../core/lib/report/emit-blocked-outcome.ts";
import { errorMessage } from "../../../../core/lib/general/error-message.ts";
import { wrapLogGroup } from "../../../../core/lib/log/log-entries.ts";
import { selectAllRefs, parseVertexAllowedLog, type VertexAllowedEntry } from "../../../../core/lib/log/vertex-log.ts";

const LOG_FILE = "/var/log/buildkitd/current";

/** Every build since the container started, not just the latest — a
 *  workflow may run several before calling report once. Best-effort: a
 *  buildctl failure here leaves the per-command breakdown empty. */
function collectBuilds(docker: Docker, containerId: string): VertexAllowedEntry[][] {
  try {
    const historiesOutput = docker.exec(containerId, ["buildctl", "debug", "histories", "--format", "{{json .}}"]);
    const refs = selectAllRefs(historiesOutput);
    return refs.map((ref) => {
      const rawJsonOutput = docker.exec(containerId, ["buildctl", "debug", "logs", "--progress=rawjson", ref]);
      return parseVertexAllowedLog(rawJsonOutput);
    });
  } catch (e) {
    console.error(`(failed to fetch allowed/audited traffic detail via buildctl: ${errorMessage(e)})`);
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
  const report = await buildExplicitReportData(docker.readFileLines(containerId, LOG_FILE), builds, parameters);

  for (const line of wrapLogGroup("HTTP Proxy communication logs", renderCommunicationDetails(report.proxyLogs.builds, report.proxyLogs.denied))) {
    console.log(line);
  }

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

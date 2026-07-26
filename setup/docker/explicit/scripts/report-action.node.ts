/**
 * report-action.js — generate and emit the outbound-traffic report for the
 * explicit proxy engine. Baked into the image, fetched fresh via
 * `docker cp` by the `report` action on every run (never staged on the
 * runner between invocations — see report/src/main.ts), then executed
 * with `node report-action.js <container-id>`.
 *
 * Runs entirely on the GitHub Actions runner, not inside the container:
 * reaches in purely via the shared Docker client (core/lib/docker/client.ts),
 * including for `buildctl debug histories`/`debug logs` (run inside the
 * container via `docker exec` rather than needing buildctl reachable from
 * the runner itself). So the `report` action itself never needs to know
 * this engine's log path, env var names, buildctl invocation, or JSON
 * shape — none of that crosses a process boundary as JSON at all, since
 * this script and the container it reads from always come from the same
 * image build.
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

/**
 * Every build since the container started, not just the latest one — a
 * workflow may run several builds against the same long-lived buildcage
 * container before calling report once, and each is its own independent
 * buildctl history record. Best-effort: a buildctl failure here shouldn't
 * take down the whole report, just leave the per-command breakdown empty.
 */
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

function main(): void {
  const containerId = process.argv[2];
  if (!containerId) {
    throw new Error("Usage: report-action.js <container-id>");
  }

  const docker = createDocker();
  const parameters = buildReportParameters(docker.readEnv(containerId));
  const logText = docker.readFile(containerId, LOG_FILE);
  const builds = collectBuilds(docker, containerId);

  const report = buildExplicitReportData(logText, builds, parameters);

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

try {
  main();
} catch (e) {
  console.log(`::error::Unexpected error in report-action: ${errorMessage(e)}`);
  process.exit(1);
}

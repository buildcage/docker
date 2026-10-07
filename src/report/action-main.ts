/**
 * The skeleton every engine's report-action.node.ts runs.
 *
 * Each engine has one of these scripts baked into its image, copied out of it
 * (not out of the running container) by the `report` action and run on the
 * runner as `node report-action.js <container-id>`, so `report` itself never
 * needs to know an engine's log paths or env var names. The five steps that
 * takes are the same for both; what differs is which logs are read and
 * what extra data is fetched, which is what `ReportActionSpec` carries.
 *
 * Lives under src/ rather than beside those scripts so that vite.config.ts's
 * `src/**` test include covers it.
 */
import * as core from "@actions/core";

import { readBooleanInput } from "#core/lib/actions/inputs.ts";
import { writeStepSummary } from "#core/lib/actions/write-step-summary.ts";
import type { Docker } from "#core/lib/docker/client.ts";
import { createDocker } from "#core/lib/docker/client.ts";
import { errorMessage } from "#core/lib/errors.ts";
import { readActionVersion } from "#core/lib/report/action-version.ts";
import { buildTrafficRecords, writeTrafficFile } from "#core/lib/report/outcome/traffic-output.ts";
import { communicationTruncationNote } from "#core/lib/report/render/communication-section.ts";
import { fitStepSummary, withNotices } from "#core/lib/report/render/fit-step-summary.ts";
import {
  renderReportBlocks,
  TRAFFIC_BLOCK,
} from "#core/lib/report/render/render-report-markdown.ts";
import { restrictExampleTruncationNote } from "#core/lib/report/render/restrict-example.ts";
import type { GenReportParameters, ReportData } from "#core/lib/report/types.ts";

import { emitReportOutcomes } from "./emit.ts";
import { buildReportParameters } from "./parameters.ts";

/** Used when the runner leaves these unset: outside Actions (the Makefile's
 *  report targets) and for a local-path `uses: ./report`. */
const DEFAULT_ACTION_REPOSITORY = "buildcage/docker";
const DEFAULT_ACTION_REF = "v4";

export interface ReportActionSpec {
  /** This image's engine. Only used to turn the version label back into the
   *  git tag it was published from. */
  proxyEngine: string;

  /** Reads this engine's logs and whatever else it needs from the container. */
  build(
    docker: Docker,
    containerId: string,
    parameters: GenReportParameters,
  ): Promise<ReportData> | ReportData;

  /** Lines to print to the job log before the summary is written. */
  logSections?(report: ReportData): string[];
}

/** Injectable so a test doesn't need argv, a real Docker daemon or the
 *  runner's environment. Defaults are what the real script gets. */
export interface ReportActionDeps {
  containerId?: string;
  docker?: Docker;
  env?: NodeJS.ProcessEnv;
  /** Read from the input when unset, which the report action has already
   *  merged with config_file. */
  failOnBlocked?: boolean;
}

/** Anything other than a false spelling fails closed, and a typo says so. The
 *  report action refuses a typo first; this covers direct runs and an older action. */
function readFailOnBlocked(): boolean {
  try {
    return readBooleanInput("fail_on_blocked", true, core.getInput);
  } catch (e) {
    // readBooleanInput throws only for a value it does not know.
    core.warning(`${errorMessage(e)} Reading it as true.`);
    return true;
  }
}

export async function runReportAction(
  spec: ReportActionSpec,
  deps: ReportActionDeps = {},
): Promise<void> {
  // Untested by design: the three defaults are the real script's own wiring:
  // its argv, the runner's environment, and a Docker client that needs a
  // daemon. Every test supplies all three, so no test can be inside them.
  /* v8 ignore start */
  const containerId = deps.containerId ?? process.argv[2];
  const env = deps.env ?? process.env;
  const docker = deps.docker ?? createDocker();
  /* v8 ignore stop */

  if (!containerId) {
    throw new Error("Usage: report-action.js <container-id>");
  }

  const parameters = buildReportParameters(docker.readEnv(containerId));
  const report = await spec.build(docker, containerId, parameters);

  for (const line of spec.logSections?.(report) ?? []) {
    console.log(line);
  }

  const blocks = renderReportBlocks(
    report,
    env.GITHUB_ACTION_REPOSITORY || DEFAULT_ACTION_REPOSITORY,
    env.GITHUB_ACTION_REF || DEFAULT_ACTION_REF,
    { actionVersion: readActionVersion(docker, containerId, spec.proxyEngine) },
  );

  emitReportOutcomes(report, {
    failOnBlocked: deps.failOnBlocked ?? readFailOnBlocked(),
    summaryFile: env.GITHUB_STEP_SUMMARY,
  });

  // The report action uploads this file as an artifact if asked; the upload
  // client is large and needs the runner's credentials, so it stays out of the
  // image and the file is written here instead. Its name is known before the
  // summary is written, so a truncated Communication details section can say
  // whether the full list is available as an artifact.
  const trafficFile = env.BUILDCAGE_TRAFFIC_FILE;
  // Both writes are tried; a failure in either is thrown once both have run.
  const failures: unknown[] = [];
  if (trafficFile) {
    try {
      writeTrafficFile(trafficFile, buildTrafficRecords(report.timeline, report.startedAt));
    } catch (e) {
      failures.push(e);
    }
  }
  try {
    await writeStepSummary(
      fitStepSummary(
        withNotices(blocks, (b) =>
          b.id === TRAFFIC_BLOCK.example
            ? restrictExampleTruncationNote(trafficFile !== undefined)
            : communicationTruncationNote(trafficFile !== undefined),
        ),
      ),
      env.GITHUB_STEP_SUMMARY,
    );
  } catch (e) {
    failures.push(e);
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, failures.map(errorMessage).join("; "));
  }
}

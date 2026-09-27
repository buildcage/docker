/**
 * The whole report step, in the order its parts have to happen in.
 *
 * Its own module rather than the entry point's body because the orderings
 * here are decisions, not wiring: the traffic file is named before the
 * script runs so the script can write to it, and the upload sits in a
 * `finally` so a run whose report failed still keeps the traffic it recorded.
 * Those are only visible from here, so this is where they are tested.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveProjectName } from "#core/lib/docker/compose-project-name.ts";
import { createDocker } from "#core/lib/docker/client.ts";
import { REPORT_ACTION_SCRIPT_PATH } from "../../../src/report/report-source.ts";
import { annotate } from "#core/lib/actions/annotation.ts";
import { copyFromContainerImage } from "./copy-from-image.ts";
import { findReportSourceContainer } from "./find-report-source.ts";
import { readBuilderName, readTrafficArtifactInputs } from "./inputs.ts";
import { runReportScript } from "./run-report-script.ts";
import { uploadTrafficArtifact } from "./traffic-artifact.ts";

/**
 * The steps this function sequences. Declared rather than imported straight
 * into the body so a test can watch the order and the arguments without
 * standing in for a dozen modules at once; each one is tested in its own file.
 *
 * `resolveProjectName` is left out on purpose and runs for real: what a test
 * wants to see of it is the name that reached `findReportSourceContainer`,
 * not the call.
 */
export interface ReportStepDeps {
  readBuilderName: typeof readBuilderName;
  readTrafficArtifactInputs: typeof readTrafficArtifactInputs;
  createDocker: typeof createDocker;
  findReportSourceContainer: typeof findReportSourceContainer;
  copyFromContainerImage: typeof copyFromContainerImage;
  runReportScript: typeof runReportScript;
  uploadTrafficArtifact: typeof uploadTrafficArtifact;
  /** A fresh directory for the copied script and the traffic JSON, and its
   *  removal. Seams because everything this step writes goes through them. */
  makeScratchDir: () => string;
  removeScratchDir: (dir: string) => void;
  /** The inputs' own migration and misuse messages. They go to the always-on
   *  emitter: this action's report is written by the script it launches. */
  warn: (message: string) => void;
}

// Untested by design: the defaults behind the two seams above, which only
// hand node:fs what the tested caller decided.
/* v8 ignore start */
const makeScratchDirInTmp = (): string => mkdtempSync(join(tmpdir(), "buildcage-report-"));
const removeScratchDirTree = (dir: string): void => rmSync(dir, { recursive: true, force: true });
/* v8 ignore stop */

const realDeps: ReportStepDeps = {
  readBuilderName,
  readTrafficArtifactInputs,
  createDocker,
  findReportSourceContainer,
  copyFromContainerImage,
  runReportScript,
  uploadTrafficArtifact,
  makeScratchDir: makeScratchDirInTmp,
  removeScratchDir: removeScratchDirTree,
  warn: annotate.warning,
};

/**
 * Runs the report step start to finish, leaving this process' exit code set
 * to the one report-action.js decided. Anything that stops the script from
 * running at all throws instead.
 */
export async function runReportStep(
  env: NodeJS.ProcessEnv,
  overrides: Partial<ReportStepDeps> = {},
): Promise<void> {
  const {
    readBuilderName,
    readTrafficArtifactInputs,
    createDocker,
    findReportSourceContainer,
    copyFromContainerImage,
    runReportScript,
    uploadTrafficArtifact,
    makeScratchDir,
    removeScratchDir,
    warn,
  } = { ...realDeps, ...overrides };

  const builderName = readBuilderName();
  const trafficArtifact = readTrafficArtifactInputs(warn);
  // The COMPOSE_PROJECT_NAME override is gated to this repo's own CI/dev
  // testing. The gate reads process.env, not the passed env, so rolldown's
  // replacePlugin folds it to a constant at build time and tree-shakes the
  // COMPOSE_PROJECT_NAME read out of a published dist, the same as src/post.ts
  // and src/lib/local-image.ts; env still supplies the value under test.
  const projectName = resolveProjectName(
    builderName,
    process.env.BUILDCAGE_BUILD_TEST_HOOKS === "1" ? env.COMPOSE_PROJECT_NAME : undefined,
  );

  const containerId = findReportSourceContainer(createDocker(), projectName, builderName);

  const scratchDir = makeScratchDir();
  // The path is handed to the script, so only a file this step created is
  // ever uploaded.
  const trafficFile = trafficArtifact.wanted ? join(scratchDir, "traffic.json") : undefined;
  try {
    const reportActionPath = join(scratchDir, "report-action.js");
    copyFromContainerImage(containerId, REPORT_ACTION_SCRIPT_PATH, reportActionPath);

    process.exitCode = runReportScript(reportActionPath, containerId, { trafficFile });
  } finally {
    // Uploaded from here so every path that ran the script keeps the file:
    // a failing run is when it is most wanted.
    if (trafficFile) {
      await uploadTrafficArtifact(trafficFile, builderName, warn, {
        retentionDays: trafficArtifact.retentionDays,
      });
    }
    removeScratchDir(scratchDir);
  }
}

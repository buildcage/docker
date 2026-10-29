import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import * as core from "@actions/core";

import { exitOnFatalError } from "#core/lib/actions/fatal.ts";
import { normalizeInputNames } from "#core/lib/actions/input-names.ts";
import { INPUT_NAMES } from "#report/report-source.ts";

import { COMPOSE_FILE } from "./compose-file.ts";
import { readLocalImageOverride } from "./lib/local-image.ts";
import { BUILDER_NAME_STATE, planPostCleanup } from "./lib/post-cleanup.ts";

// Untested by design, down to the end of the file: planPostCleanup decides the
// arguments, and running them is docker's own.
/* v8 ignore start */
// Gates the COMPOSE_PROJECT_NAME override to this repo's own CI/dev testing.
const PROJECT_NAME_OVERRIDE_ENABLED = process.env.BUILDCAGE_BUILD_TEST_HOOKS === "1";

async function main(): Promise<void> {
  // Setup has warned of any underscore spelling it ignored.
  normalizeInputNames(process.env, INPUT_NAMES);
  // Read as setup read it, so the down also takes the fixtures its overlay started.
  const localOverride = await readLocalImageOverride(process.env, () => {});
  const plan = planPostCleanup(
    COMPOSE_FILE,
    PROJECT_NAME_OVERRIDE_ENABLED ? process.env.COMPOSE_PROJECT_NAME : undefined,
    process.env,
    {
      savedBuilderName: core.getState(BUILDER_NAME_STATE),
      composeOverlay: localOverride?.composeOverlay,
    },
  );
  if (!plan) {
    core.info("No builder to remove: the setup step stopped before it named one.");
    return;
  }
  execFileSync("docker", plan.args, { stdio: "inherit", env: plan.env });
}
// Node resolves symlinks in import.meta.url but not in argv, and the runner
// may reach the checkout through one.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(exitOnFatalError("post"));
}
/* v8 ignore stop */

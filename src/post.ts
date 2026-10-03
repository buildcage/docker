import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import * as core from "@actions/core";

import { BUILDER_NAME_STATE, planPostCleanup } from "./lib/post-cleanup.ts";

// Untested by design, down to the end of the file: planPostCleanup decides the
// arguments, and running them is docker's own.
/* v8 ignore start */
const __dirname = dirname(fileURLToPath(import.meta.url));

// Gates the COMPOSE_PROJECT_NAME override to this repo's own CI/dev testing.
const PROJECT_NAME_OVERRIDE_ENABLED = process.env.BUILDCAGE_BUILD_TEST_HOOKS === "1";

function main(): void {
  const { args, env } = planPostCleanup(
    join(__dirname, "../docker/compose.action.yaml"),
    PROJECT_NAME_OVERRIDE_ENABLED ? process.env.COMPOSE_PROJECT_NAME : undefined,
    process.env,
    { savedBuilderName: core.getState(BUILDER_NAME_STATE) },
  );
  execFileSync("docker", args, { stdio: "inherit", env });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
/* v8 ignore stop */

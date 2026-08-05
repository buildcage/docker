import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@actions/core";
import { resolveProjectName } from "../../core/lib/docker/compose-project-name.ts";
import { buildComposeDownArgs } from "../../core/lib/docker/args.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Gates the COMPOSE_PROJECT_NAME override to this repo's own CI/dev testing.
const PROJECT_NAME_OVERRIDE_ENABLED = process.env.BUILDCAGE_BUILD_TEST_HOOKS === "1";

function main(): void {
  // builder_name is a real input, so post.ts can recompute the same project
  // name main.ts used directly, without round-tripping it through GITHUB_STATE.
  const builderName = core.getInput("builder_name") || "buildcage";
  const projectName = resolveProjectName(
    builderName,
    PROJECT_NAME_OVERRIDE_ENABLED ? process.env.COMPOSE_PROJECT_NAME : undefined,
  );

  execFileSync(
    "docker",
    buildComposeDownArgs({ composeFile: join(__dirname, "../compose.yaml"), projectName }),
    {
      stdio: "inherit",
      env: {
        ...process.env,
        BUILDER_NAME: builderName,
      },
    },
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

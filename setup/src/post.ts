import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveProjectName } from "../../core/lib/docker/container.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

// CI-only override gate, mirrors report/src/main.ts's resolveProjectName.
const PROJECT_NAME_OVERRIDE_ENABLED = process.env.BUILDCAGE_BUILD_TEST_HOOKS === "1";

// Same derivation report uses for its own lookup.
export function resolveProjectName(builderName: string, env: NodeJS.ProcessEnv): string {
  if (PROJECT_NAME_OVERRIDE_ENABLED && env.COMPOSE_PROJECT_NAME) {
    return env.COMPOSE_PROJECT_NAME;
  }
  return deriveProjectName(builderName);
}

function main(): void {
  // builder_name is a real input, so post.ts can recompute the same project
  // name main.ts used directly, without round-tripping it through GITHUB_STATE.
  const builderName = process.env.INPUT_BUILDER_NAME || "buildcage";
  const projectName = resolveProjectName(builderName, process.env);

  execFileSync(
    "docker",
    ["compose", "-p", projectName, "-f", join(__dirname, "../compose.yaml"), "down"],
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

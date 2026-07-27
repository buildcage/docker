import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveProjectName } from "../../core/lib/docker/container.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

// builder_name is a real input, so post.ts can recompute the same project
// name main.ts used directly, without round-tripping it through GITHUB_STATE.
const builderName = process.env.INPUT_BUILDER_NAME || "buildcage";
const projectName = deriveProjectName(builderName);

execFileSync(
  "docker",
  ["compose", "-p", projectName, "-f", join(__dirname, "../compose.yaml"), "down"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      BUILDER_NAME: builderName,
    },
  }
);

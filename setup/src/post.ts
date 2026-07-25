import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveProjectName } from "../../core/lib/docker/container.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

// builder_name is a real input (unlike run's randomly-generated container
// name), so post.ts can just recompute the same project name main.ts used
// directly from it — no need to round-trip it through GITHUB_STATE. Without
// -p here, this would target Compose's own implicit, directory-derived
// project name instead of the one main.ts actually started the container
// under (see core/lib/docker/container.ts's deriveProjectName), leaving the
// real container running.
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

import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

execFileSync(
  "docker",
  ["compose", "-f", join(__dirname, "compose.yml"), "down"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      BUILDER_NAME: env.INPUT_BUILDER_NAME || "buildcage",
    },
  }
);

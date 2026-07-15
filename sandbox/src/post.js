import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Fallback-only cleanup: main.js already stops the proxy container in its
// own finally block on every normal exit path. This only matters if the
// process was killed outright before reaching that finally (e.g. the
// runner cancels the step). GITHUB_STATE's container_name=... (written by
// main.js) surfaces here as STATE_container_name — see
// https://docs.github.com/en/actions/creating-actions/dockerfile-support-for-github-actions#saving-state.
const containerName = process.env.STATE_container_name;
if (containerName) {
  execFileSync(
    "docker",
    ["compose", "-f", join(__dirname, "../compose.yaml"), "down"],
    {
      stdio: "inherit",
      env: { ...process.env, SANDBOX_CONTAINER_NAME: containerName },
    },
  );
}

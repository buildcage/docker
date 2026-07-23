import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { buildComposeDownArgs } from "./lib/compose-args.ts";
import { cleanupScratchDir, scratchDirFor } from "./lib/isolated-exec.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Fallback-only cleanup: main.js already stops the proxy container in its
// own finally block on every normal exit path. This only matters if the
// process was killed outright before reaching that finally (e.g. the
// runner cancels the step). GITHUB_STATE's container_name=.../project_name=...
// (written by main.js) surface here as STATE_container_name/STATE_project_name
// — see
// https://docs.github.com/en/actions/creating-actions/dockerfile-support-for-github-actions#saving-state.
const containerName = process.env.STATE_container_name;
const projectName = process.env.STATE_project_name;

// Reclaim this step's sandbox scratch dir if a hard kill bypassed main.js's
// own withScratchDir finally. Its path is derived deterministically from
// containerName (scratchDirFor), so no separately recorded path is needed.
// cleanupScratchDir force-detaches the rootfs bind-mount before deleting, so
// this can't walk into the host filesystem even if a mount somehow survived.
// Independent of the container teardown below, so it runs regardless.
if (containerName?.startsWith("buildcage-proxy-")) {
  try {
    const scratchDir = scratchDirFor(containerName);
    if (existsSync(scratchDir)) cleanupScratchDir(scratchDir);
  } catch (e) {
    console.log(`::warning::run post-cleanup: failed to remove sandbox scratch dir: ${(e as Error).message}`);
  }
}

if (containerName && projectName) {
  execFileSync(
    "docker",
    buildComposeDownArgs({ composeFile: join(__dirname, "../compose.yaml"), projectName }),
    {
      stdio: "inherit",
      env: { ...process.env, PROXY_CONTAINER_NAME: containerName },
    },
  );
} else if (containerName) {
  // Without project_name, the only fallback compose can use is its
  // implicit, directory-derived project name — which every concurrent
  // `run` step in the job shares. Running `down` against it would risk
  // tearing down another step's still-running proxy container, the exact
  // collision this project-name scheme exists to prevent, so skip cleanup
  // instead.
  console.log(
    `::warning::run post-cleanup: container_name is set but project_name is missing from GITHUB_STATE; skipping cleanup to avoid targeting Compose's implicit, shared project name. Container ${containerName} may need manual removal.`,
  );
}

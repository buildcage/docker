import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const composeFile = join(__dirname, "compose.yml");

/**
 * Determine the Docker image version to use.
 * Priority: explicit input > action ref tag > fallback "1"
 *
 * When called as `dash14/buildcage/setup@v1.0`, GITHUB_ACTION_REF is "v1.0".
 * Strip the "v" prefix if present, verify the image exists, then use it.
 * For non-v refs (commit hash, branch), check image existence with raw ref.
 * If the image doesn't exist, fall back to "1".
 */
function resolveVersion(image) {
  if (process.env.INPUT_BUILDCAGE_VERSION) {
    return process.env.INPUT_BUILDCAGE_VERSION;
  }

  const ref = process.env.GITHUB_ACTION_REF || "";
  if (ref) {
    // Full SHA (40 hex chars) → prefix with "sha-" to match image tag convention
    const version = /^[0-9a-f]{40}$/i.test(ref) ? `sha-${ref.toLowerCase()}`
      : ref.startsWith("v") ? ref.slice(1)
      : ref;
    try {
      execFileSync("docker", ["manifest", "inspect", `${image}:${version}`], {
        stdio: "pipe",
      });
      return version;
    } catch {
      // Image with this version doesn't exist; fall through
    }
  }

  return "1";
}

const buildcageImage = (process.env.INPUT_BUILDCAGE_IMAGE
  || `ghcr.io/${process.env.GITHUB_ACTION_REPOSITORY}`).toLowerCase();
const buildcageVersion = resolveVersion(buildcageImage);

console.log(`buildcage image: ${buildcageImage}:${buildcageVersion}`);

const composeEnv = {
  ...process.env,
  PROXY_MODE: process.env.INPUT_PROXY_MODE || "restrict",
  ALLOWED_HTTP_DOMAINS: process.env.INPUT_ALLOWED_HTTP_DOMAINS || "",
  ALLOWED_HTTPS_DOMAINS: process.env.INPUT_ALLOWED_HTTPS_DOMAINS || "",
  HTTP_PORTS: process.env.INPUT_HTTP_PORTS || "80",
  HTTPS_PORTS: process.env.INPUT_HTTPS_PORTS || "443",
  BUILDCAGE_IMAGE: buildcageImage,
  BUILDCAGE_VERSION: buildcageVersion,
  PORT: process.env.INPUT_PORT || "1234",
};

execFileSync(
  "docker",
  ["compose", "-f", composeFile, "down"],
  { stdio: "inherit", env: composeEnv }
);

execFileSync(
  "docker",
  [
    "compose",
    "-f", composeFile,
    "up", "-d", "--pull", "always", "--no-build", "--wait",
  ],
  { stdio: "inherit", env: composeEnv }
);

// Set action output
const port = process.env.INPUT_PORT || "1234";
appendFileSync(process.env.GITHUB_OUTPUT, `port=${port}\n`);

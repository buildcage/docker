import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

execFileSync(
  "docker",
  [
    "compose",
    "-f", join(__dirname, "compose.yml"),
    "up", "-d", "--pull", "always", "--no-build", "--wait",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      PROXY_MODE: process.env.INPUT_PROXY_MODE || "restrict",
      ALLOWED_HTTP_DOMAINS: process.env.INPUT_ALLOWED_HTTP_DOMAINS || "",
      ALLOWED_HTTPS_DOMAINS: process.env.INPUT_ALLOWED_HTTPS_DOMAINS || "",
      BUILDCAGE_IMAGE: process.env.INPUT_BUILDCAGE_IMAGE || "ghcr.io/dash14/buildcage",
      BUILDCAGE_VERSION: process.env.INPUT_BUILDCAGE_VERSION || "1",
      PORT: process.env.INPUT_PORT || "1234",
    },
  }
);

// Set action output
const port = process.env.INPUT_PORT || "1234";
appendFileSync(process.env.GITHUB_OUTPUT, `port=${port}\n`);

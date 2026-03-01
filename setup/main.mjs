import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRules, buildLegacyRules } from "./rules.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const composeFile = join(__dirname, "compose.yml");

function main() {
  const env = process.env;

  const image = resolveBuildcageImage({
    imageInput: env.INPUT_BUILDCAGE_IMAGE,
    versionInput: env.INPUT_BUILDCAGE_VERSION,
    actionRepository: env.GITHUB_ACTION_REPOSITORY,
    actionRef: env.GITHUB_ACTION_REF,
  });
  console.log(`buildcage image: ${image.repository}:${image.tag}`);

  let rules;
  try {
    rules = buildACLRules({
      httpsRulesInput: env.INPUT_ALLOWED_HTTPS_RULES,
      httpRulesInput: env.INPUT_ALLOWED_HTTP_RULES,
      ipRulesInput: env.INPUT_ALLOWED_IP_RULES,
      httpsDomainsInput: env.INPUT_ALLOWED_HTTPS_DOMAINS,
      httpDomainsInput: env.INPUT_ALLOWED_HTTP_DOMAINS,
      httpsPortsInput: env.INPUT_HTTPS_PORTS,
      httpPortsInput: env.INPUT_HTTP_PORTS,
    });
  } catch (e) {
    console.log(`::error::${e.message}`);
    process.exit(1);
  }

  console.log("::group::Configured ACL Rules");
  logRules("HTTPS", rules.httpsRules);
  logRules("HTTP", rules.httpRules);
  logRules("IP", rules.ipRules);
  console.log("::endgroup::");

  const composeEnv = {
    ...env,
    PROXY_MODE: env.INPUT_PROXY_MODE || "restrict",
    ALLOWED_HTTPS_RULES: rules.httpsRules.join('\n'),
    ALLOWED_HTTP_RULES: rules.httpRules.join('\n'),
    ALLOWED_IP_RULES: rules.ipRules.join('\n'),
    BUILDCAGE_IMAGE: image.repository,
    BUILDCAGE_VERSION: image.tag,
    PORT: env.INPUT_PORT || "1234",
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
  const port = env.INPUT_PORT || "1234";
  appendFileSync(env.GITHUB_OUTPUT, `port=${port}\n`);
}

/**
 * Resolve the buildcage Docker image name and tag.
 *
 * @returns {{ repository: string, tag: string }}
 */
function resolveBuildcageImage({ imageInput, versionInput, actionRepository, actionRef }) {
  const repository = (imageInput || `ghcr.io/${actionRepository}`).toLowerCase();
  const tag = resolveImageTag(repository, { versionInput, actionRef });
  return { repository, tag };
}

/**
 * Determine the Docker image tag to use.
 * Priority: explicit input > action ref tag > fallback "1"
 *
 * When called as `dash14/buildcage/setup@v1.0`, GITHUB_ACTION_REF is "v1.0".
 * Strip the "v" prefix if present, verify the image exists, then use it.
 * For non-v refs (commit hash, branch), check image existence with raw ref.
 * If the image doesn't exist, fall back to "1".
 */
function resolveImageTag(repository, { versionInput, actionRef }) {
  if (versionInput) {
    return versionInput;
  }

  if (actionRef) {
    // Full SHA (40 hex chars) → prefix with "sha-" to match image tag convention
    const tag = /^[0-9a-f]{40}$/i.test(actionRef) ? `sha-${actionRef.toLowerCase()}`
      : actionRef.startsWith("v") ? actionRef.slice(1)
      : actionRef;
    try {
      execFileSync("docker", ["manifest", "inspect", `${repository}:${tag}`], {
        stdio: "pipe",
      });
      return tag;
    } catch {
      // Image with this tag doesn't exist; fall through
    }
  }

  return "1";
}

/**
 * Build ACL rules by merging new-style rules and legacy rules.
 * Each property is an array of regex strings (not yet joined).
 *
 * @returns {{ httpsRules: string[], httpRules: string[], ipRules: string[] }}
 */
function buildACLRules({ httpsRulesInput, httpRulesInput, ipRulesInput, httpsDomainsInput, httpDomainsInput, httpsPortsInput, httpPortsInput }) {
  // New-style rules
  const httpsRules = buildRules(httpsRulesInput);
  const httpRules = buildRules(httpRulesInput);
  const ipRules = buildRules(ipRulesInput);

  // Legacy rules
  const httpsLegacy = buildLegacyRules({
    domainsInput: httpsDomainsInput,
    portsInput: httpsPortsInput,
    defaultPort: 443,
    protocol: "HTTPS",
  });
  const httpLegacy = buildLegacyRules({
    domainsInput: httpDomainsInput,
    portsInput: httpPortsInput,
    defaultPort: 80,
    protocol: "HTTP",
  });
  return {
    httpsRules: [...httpsRules, ...httpsLegacy],
    httpRules: [...httpRules, ...httpLegacy],
    ipRules,
  };
}

function logRules(label, rules) {
  console.log(`${label} rules:${rules.length === 0 ? " (none)" : ""}`);
  for (const r of rules) console.log(`  ${r}`);
}

main();

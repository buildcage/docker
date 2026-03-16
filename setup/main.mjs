import { execFileSync } from "node:child_process";
import { buildLegacyRules } from "./lib/legacy-rules.mjs";
import { buildRules } from "../docker/files/tools/lib/rules.mjs";

function main() {
  const env = process.env;
  const name = env.INPUT_NAME || "buildcage";

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

  const proxyMode = env.INPUT_PROXY_MODE || "restrict";

  // Remove existing builder if present
  try {
    execFileSync("docker", ["buildx", "rm", name], { stdio: "inherit" });
  } catch {
    // Builder doesn't exist yet — that's fine
  }

  // Create and bootstrap the builder
  const driverOpts = [
    `image=${image.repository}:${image.tag}`,
    `env.PROXY_MODE=${proxyMode}`,
    `env.ALLOWED_HTTPS_RULES=${rules.httpsRules.join('\n')}`,
    `env.ALLOWED_HTTP_RULES=${rules.httpRules.join('\n')}`,
    `env.ALLOWED_IP_RULES=${rules.ipRules.join('\n')}`,
  ];

  const args = [
    "buildx", "create",
    "--bootstrap",
    "--name", name,
    "--driver", "docker-container",
  ];
  for (const opt of driverOpts) {
    args.push("--driver-opt", opt);
  }

  execFileSync("docker", args, { stdio: "inherit" });

  // Verify the container is running
  const containerId = findBuildkitContainer(name);
  console.log(`Buildcage container running: ${containerId}`);
}

/**
 * Find the Buildkit container ID for the given builder name.
 */
function findBuildkitContainer(name) {
  try {
    const id = execFileSync(
      "docker", ["ps", "-q", "-f", `name=buildx_buildkit_${name}`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    ).trim();
    if (!id) throw new Error(`Buildcage container not found for builder "${name}"`);
    return id;
  } catch (e) {
    console.log(`::error::${e.message}`);
    process.exit(1);
  }
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
 * New-style rules are passed through as-is (wildcard format).
 * Legacy rules are converted to wildcard format.
 *
 * @returns {{ httpsRules: string[], httpRules: string[], ipRules: string[] }}
 */
function buildACLRules({ httpsRulesInput, httpRulesInput, ipRulesInput, httpsDomainsInput, httpDomainsInput, httpsPortsInput, httpPortsInput }) {
  // New-style rules: pass through as-is (wildcard format), validate by converting to regex
  const httpsRules = httpsRulesInput?.trim().split(/\s+/).filter(Boolean) ?? [];
  const httpRules = httpRulesInput?.trim().split(/\s+/).filter(Boolean) ?? [];
  const ipRules = ipRulesInput?.trim().split(/\s+/).filter(Boolean) ?? [];
  buildRules(httpsRulesInput);
  buildRules(httpRulesInput);
  buildRules(ipRulesInput);

  // Legacy rules (converted to wildcard format)
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

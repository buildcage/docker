import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { buildRules } from "../../docker/files/tools/lib/rules.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const composeFile = join(__dirname, "../compose.yml");

function main() {
  const env = process.env;

  // Digest is written to GITHUB_STATE by pre.mjs; empty when ref has no matching tag.
  const imageRef = resolveBuildcageImageRef({
    imageDigest: env.STATE_BUILDCAGE_DIGEST,
    actionRepository: env.GITHUB_ACTION_REPOSITORY,
    actionRef: env.GITHUB_ACTION_REF,
  });
  console.log(`buildcage image: ${imageRef}`);

  let rules;
  try {
    rules = buildACLRules({
      httpsRulesInput: env.INPUT_ALLOWED_HTTPS_RULES,
      httpRulesInput: env.INPUT_ALLOWED_HTTP_RULES,
      ipRulesInput: env.INPUT_ALLOWED_IP_RULES,
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
    BUILDER_NAME: env.INPUT_BUILDER_NAME || "buildcage",
    PROXY_MODE: env.INPUT_PROXY_MODE || "restrict",
    ALLOWED_HTTPS_RULES: rules.httpsRules.join('\n'),
    ALLOWED_HTTP_RULES: rules.httpRules.join('\n'),
    ALLOWED_IP_RULES: rules.ipRules.join('\n'),
    BUILDCAGE_IMAGE_REF: imageRef,
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
}

/**
 * Resolve the buildcage Docker image reference (image@digest or image:tag).
 * The repository is always derived from the action repository — external image
 * overrides are intentionally not supported to preserve cosign verification integrity.
 *
 * @param {{ imageDigest: string|undefined, actionRepository: string, actionRef: string }} opts
 * @param {function} [_exec] - Override for execFileSync (used in tests)
 * @returns {string} Full image reference (e.g. "ghcr.io/owner/repo@sha256:..." or "ghcr.io/owner/repo:2.0.1")
 */
export function resolveBuildcageImageRef({ imageDigest, actionRepository, actionRef }, _exec = execFileSync) {
  const repository = `ghcr.io/${actionRepository}`.toLowerCase();
  if (imageDigest) {
    // Use the verified manifest list digest to guarantee the same bytes as verified.
    // This eliminates any TOCTOU window between cosign verify and docker pull.
    return `${repository}@${imageDigest}`;
  }
  const tag = resolveImageTag(repository, { actionRef }, _exec);
  return `${repository}:${tag}`;
}

/**
 * Determine the Docker image tag from the action ref.
 * Throws if the ref cannot be resolved to an existing image tag.
 *
 * Used only when no verified digest is available (e.g. branch/local references).
 *
 * @param {string} repository
 * @param {{ actionRef: string|undefined }} opts
 * @param {function} [_exec] - Override for execFileSync (used in tests)
 */
export function resolveImageTag(repository, { actionRef }, _exec = execFileSync) {
  if (actionRef) {
    // Full SHA (40 hex chars) → prefix with "sha-" to match image tag convention
    const tag = /^[0-9a-f]{40}$/i.test(actionRef) ? `sha-${actionRef.toLowerCase()}`
      : actionRef.startsWith("v") ? actionRef.slice(1)
      : actionRef;
    try {
      _exec("docker", ["manifest", "inspect", `${repository}:${tag}`], {
        stdio: "pipe",
      });
      return tag;
    } catch {
      // Image with this tag doesn't exist; fall through
    }
  }

  // No fallback: branch refs and local ./setup references land here.
  // These are intentionally unsupported outside of development use.
  // Pin the action to a version tag or commit SHA for production use.
  throw new Error(
    `Cannot resolve Docker image tag for action ref: ${JSON.stringify(actionRef)}. ` +
    `Pin the action to a version tag (e.g. @v2.1.0) or commit SHA.`
  );
}

/**
 * Build ACL rules from input strings.
 * Rules are passed through as-is (wildcard format), validated by converting to regex.
 *
 * @returns {{ httpsRules: string[], httpRules: string[], ipRules: string[] }}
 */
export function buildACLRules({ httpsRulesInput, httpRulesInput, ipRulesInput }) {
  const httpsRules = httpsRulesInput?.trim().split(/\s+/).filter(Boolean) ?? [];
  const httpRules = httpRulesInput?.trim().split(/\s+/).filter(Boolean) ?? [];
  const ipRules = ipRulesInput?.trim().split(/\s+/).filter(Boolean) ?? [];
  buildRules(httpsRulesInput);
  buildRules(httpRulesInput);
  buildRules(ipRulesInput);

  return { httpsRules, httpRules, ipRules };
}

function logRules(label, rules) {
  console.log(`${label} rules:${rules.length === 0 ? " (none)" : ""}`);
  for (const r of rules) console.log(`  ${r}`);
}

// Run main() only when executed directly as an entrypoint (not imported in tests)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { buildRules } from "../../docker/tools/shared/lib/rules.js";
import { SetupError } from "./lib/errors.js";
import { imageTagFromRef, verifyImageDigest } from "./lib/verify-image.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const composeFile = join(__dirname, "../compose.yaml");

async function main() {
  const env = process.env;
  const actionRef = env.GITHUB_ACTION_REF ?? "";
  const actionRepo = env.GITHUB_ACTION_REPOSITORY ?? "";

  const proxyEngine = resolveProxyEngine(env.INPUT_PROXY_ENGINE);
  console.log(`Proxy engine: ${proxyEngine}`);

  // Verify image provenance before pulling.
  // verifyImageDigest returns null for unverifiable refs (branch / local ./setup).
  // On failure it throws SetupError — printed by the top-level catch.
  const digest = await verifyImageDigest({ actionRef, actionRepo, proxyEngine });
  let imageRef;
  if (digest === null) {
    if (
      env.BUILDCAGE_ALLOW_UNVERIFIED === "1" ||
      env.BUILDCAGE_ALLOW_UNVERIFIED?.toLowerCase() === "true"
    ) {
      console.log(
        `::warning::Skipping image provenance verification for unverifiable ref: ` +
          `${JSON.stringify(actionRef)}. The image will be pulled without verification.`,
      );
      imageRef = resolveBuildcageImageRef({
        imageDigest: undefined,
        actionRepository: actionRepo,
        actionRef,
        proxyEngine,
      });
    } else {
      throw new SetupError(
        `Cannot verify image provenance for ref: ${JSON.stringify(actionRef)}. ` +
          `Pin the action to a version tag (e.g. @v2.1.0) or a commit SHA.`,
        "UNVERIFIABLE_REF",
      );
    }
  } else {
    console.log(`Image provenance verified for ref: ${JSON.stringify(actionRef)} (digest ${digest}).`);
    imageRef = resolveBuildcageImageRef({
      imageDigest: digest,
      actionRepository: actionRepo,
      actionRef,
      proxyEngine,
    });
  }
  console.log(`buildcage image: ${imageRef}`);

  const rules = buildACLRules({
    httpsRulesInput: env.INPUT_ALLOWED_HTTPS_RULES,
    httpRulesInput: env.INPUT_ALLOWED_HTTP_RULES,
    ipRulesInput: env.INPUT_ALLOWED_IP_RULES,
  });

  console.log("::group::Configured ACL Rules");
  logRules("HTTPS", rules.httpsRules);
  logRules("HTTP", rules.httpRules);
  logRules("IP", rules.ipRules);
  console.log("::endgroup::");

  const composeEnv = {
    ...env,
    BUILDER_NAME: env.INPUT_BUILDER_NAME || "buildcage",
    PROXY_MODE: env.INPUT_PROXY_MODE || "restrict",
    PROXY_ENGINE: proxyEngine,
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
      "up", "-d", "--pull", "always", "--no-build", "--wait", "--quiet-pull",
    ],
    { stdio: "inherit", env: composeEnv }
  );
}

/**
 * Resolve the buildcage Docker image reference (image@digest or image:tag).
 * The repository is always derived from the action repository — external image
 * overrides are intentionally not supported to preserve Sigstore verification integrity.
 */
export function resolveBuildcageImageRef({ imageDigest, actionRepository, actionRef, proxyEngine = "explicit" }, _exec = execFileSync) {
  const repository = `ghcr.io/${actionRepository}`.toLowerCase();
  if (imageDigest) {
    // Pull by verified digest to close the TOCTOU window between verification and docker pull.
    return `${repository}@${imageDigest}`;
  }
  const tag = resolveImageTag(repository, { actionRef, proxyEngine }, _exec);
  return `${repository}:${tag}`;
}

/**
 * Determine the Docker image tag from the action ref.
 * Throws if the ref cannot be resolved to an existing image tag.
 * Used only when no verified digest is available (branch/local references).
 */
export function resolveImageTag(repository, { actionRef, proxyEngine = "explicit" }, _exec = execFileSync) {
  const attemptedTag = actionRef ? imageTagFromRef(actionRef, proxyEngine) : undefined;
  if (actionRef) {
    try {
      _exec("docker", ["manifest", "inspect", `${repository}:${attemptedTag}`], {
        stdio: "pipe",
      });
      return attemptedTag;
    } catch {
      // Image with this tag doesn't exist; fall through
    }
  }

  // No fallback: branch refs and local ./setup references land here.
  // These are intentionally unsupported outside of development use.
  // Pin the action to a version tag or commit SHA for production use.
  throw new SetupError(
    `Cannot resolve Docker image tag for action ref: ${JSON.stringify(actionRef)}` +
    (attemptedTag ? ` (tried "${attemptedTag}")` : "") + `. ` +
    `Pin the action to a version tag (e.g. @v2.1.0) or commit SHA.`,
    "TAG_UNRESOLVED",
  );
}

/**
 * Resolve and validate the proxy_engine input.
 * Only "explicit" (default) and "transparent" are accepted — each maps to a
 * separately published, separately tagged Docker image (see resolveImageTag).
 */
export function resolveProxyEngine(input) {
  const engine = input?.trim() || "explicit";
  if (engine !== "transparent" && engine !== "explicit") {
    throw new SetupError(
      `Invalid proxy_engine: ${JSON.stringify(input)}. Must be "transparent" or "explicit".`,
      "INVALID_PROXY_ENGINE",
    );
  }
  return engine;
}

/**
 * Build ACL rules from input strings.
 * Rules are passed through as-is (wildcard format), validated by converting to regex.
 */
export function buildACLRules({ httpsRulesInput, httpRulesInput, ipRulesInput }) {
  const httpsRules = httpsRulesInput?.trim().split(/\s+/).filter(Boolean) ?? [];
  const httpRules = httpRulesInput?.trim().split(/\s+/).filter(Boolean) ?? [];
  const ipRules = ipRulesInput?.trim().split(/\s+/).filter(Boolean) ?? [];
  try {
    buildRules(httpsRulesInput);
    buildRules(httpRulesInput);
    buildRules(ipRulesInput);
  } catch (e) {
    throw new SetupError(e.message, "INVALID_RULES");
  }

  return { httpsRules, httpRules, ipRules };
}

function logRules(label, rules) {
  console.log(`${label} rules:${rules.length === 0 ? " (none)" : ""}`);
  for (const r of rules) console.log(`  ${r}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    if (err instanceof SetupError) {
      console.log(`::error::${err.message}`);
    } else {
      console.log(`::error::Unexpected error in setup: ${err.message}`);
    }
    process.exit(1);
  });
}

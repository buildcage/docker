import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { buildRules } from "../../docker/tools/shared/lib/rules.js";
import { SetupError } from "./lib/errors.js";
import { verifyImageDigest } from "./lib/verify-image.js";
import { resolveBuildcageImageRef } from "./lib/image-ref.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const composeFile = join(__dirname, "../compose.yaml");

// Gates a local-image override used only by this repo's own CI/dev testing
// (see test_action in .github/workflows/test.yml), never by a consumer of a
// published action. A normal build physically excludes
// lib/local-image-override.js (rollup tree-shakes the dead import); the
// unit_test CI job also greps the built output as a backstop.
const LOCAL_IMAGE_OVERRIDE_ENABLED = process.env.BUILDCAGE_BUILD_TEST_HOOKS === "1";

/**
 * Verifies image provenance and resolves the digest-pinned image ref.
 * Throws SetupError("UNVERIFIABLE_REF") if verification can't be performed
 * (branch ref / local ./setup) — printed by the top-level catch.
 */
async function resolveVerifiedImage({ actionRef, actionRepo, proxyEngine }) {
  const digest = await verifyImageDigest({ actionRef, actionRepo, proxyEngine });
  if (digest === null) {
    throw new SetupError(
      `Cannot verify image provenance for ref: ${JSON.stringify(actionRef)}. ` +
        `Pin the action to a version tag (e.g. @v2.1.0) or a commit SHA.`,
      "UNVERIFIABLE_REF",
    );
  }
  console.log(`Image provenance verified for ref: ${JSON.stringify(actionRef)} (digest ${digest}).`);
  return {
    imageRef: resolveBuildcageImageRef({ imageDigest: digest, actionRepository: actionRepo }),
    pullPolicy: "always",
  };
}

async function main() {
  const env = process.env;
  const actionRef = env.GITHUB_ACTION_REF ?? "";
  const actionRepo = env.GITHUB_ACTION_REPOSITORY ?? "";

  const proxyEngine = resolveProxyEngine(env.INPUT_PROXY_ENGINE);
  console.log(`Proxy engine: ${proxyEngine}`);

  const localOverride = LOCAL_IMAGE_OVERRIDE_ENABLED
    ? (await import("./lib/local-image-override.js")).readLocalImageOverride(env)
    : null;
  if (localOverride) {
    console.log(
      `BUILDCAGE_LOCAL_IMAGE_REF is set (${JSON.stringify(localOverride.imageRef)}) — ` +
        `skipping image provenance verification and registry tag resolution entirely. ` +
        `This bypass exists only for buildcage's own CI self-tests and local development and is ` +
        `dead-code-eliminated from every published release build.`,
    );
  }
  const { imageRef, pullPolicy } =
    localOverride ?? (await resolveVerifiedImage({ actionRef, actionRepo, proxyEngine }));
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
    // "buildcage" here is a fallback for running outside the Actions runtime
    // (action.yml's own `default: 'buildcage'` covers the normal case) — keep
    // both, and report/src/main.js's copy, in sync.
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
      "up", "-d", "--pull", pullPolicy, "--no-build", "--wait", "--quiet-pull",
    ],
    { stdio: "inherit", env: composeEnv }
  );
}

/**
 * Resolve and validate the proxy_engine input.
 * Only "transparent" (default) and "explicit" are accepted — each maps to a
 * separately published, separately tagged Docker image (see
 * lib/verify-image.js's imageTagFromRef).
 */
export function resolveProxyEngine(input) {
  const engine = input?.trim() || "transparent";
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

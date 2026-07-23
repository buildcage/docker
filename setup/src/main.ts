import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { parseAndValidateRules } from "../../core/shared/lib/rules.js";
import { SetupError } from "./lib/errors.ts";
import { ActionError } from "../../core/lib/general/action-error.ts";
import { verifyImageDigestOrThrow } from "../../core/lib/provenance/verify-image.ts";
import { resolveBuildcageImageRef } from "../../core/lib/provenance/image-ref.ts";
import { describeDockerFailure, type DockerErrorLike } from "../../core/lib/actions/docker-error.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const composeFile = join(__dirname, "../compose.yaml");

// Gates a local-image override used only by this repo's own CI/dev testing
// (see test_action in .github/workflows/test-e2e.yml), never by a consumer of
// a published action. A normal build physically excludes
// core/lib/provenance/local-image-override.ts (rolldown tree-shakes the dead import); the
// unit_test CI job also greps the built output as a backstop.
const LOCAL_IMAGE_OVERRIDE_ENABLED = process.env.BUILDCAGE_BUILD_TEST_HOOKS === "1";

/**
 * Verifies image provenance and resolves the digest-pinned image ref.
 * Throws ProvenanceError("UNVERIFIABLE_REF") if verification can't be
 * performed (branch ref / local ./setup) — printed by the top-level catch.
 */
async function resolveVerifiedImage({
  actionRef,
  actionRepo,
  proxyEngine,
}: {
  actionRef: string;
  actionRepo: string;
  proxyEngine: string;
}): Promise<{ imageRef: string; pullPolicy: "always" }> {
  const digest = await verifyImageDigestOrThrow({ actionRef, actionRepo, proxyEngine });
  console.log(`Image provenance verified for ref: ${JSON.stringify(actionRef)} (digest ${digest}).`);
  return {
    imageRef: resolveBuildcageImageRef({ imageDigest: digest, actionRepository: actionRepo }),
    pullPolicy: "always",
  };
}

async function main(): Promise<void> {
  const env = process.env;
  const actionRef = env.GITHUB_ACTION_REF ?? "";
  const actionRepo = env.GITHUB_ACTION_REPOSITORY ?? "";

  const proxyEngine = resolveProxyEngine(env.INPUT_PROXY_ENGINE);
  console.log(`Proxy engine: ${proxyEngine}`);

  const localOverride = LOCAL_IMAGE_OVERRIDE_ENABLED
    ? (await import("../../core/lib/provenance/local-image-override.ts")).readLocalImageOverride(env)
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

  try {
    execFileSync(
      "docker",
      ["compose", "-f", composeFile, "down"],
      { stdio: "inherit", env: composeEnv }
    );
  } catch (e) {
    throw new SetupError(
      describeDockerFailure(e as DockerErrorLike, { operation: "docker compose down" }),
      "DOCKER_UNAVAILABLE",
    );
  }

  try {
    execFileSync(
      "docker",
      [
        "compose",
        "-f", composeFile,
        "up", "-d", "--pull", pullPolicy, "--no-build", "--wait", "--quiet-pull",
      ],
      { stdio: "inherit", env: composeEnv }
    );
  } catch (e) {
    throw new SetupError(
      describeDockerFailure(e as DockerErrorLike, { operation: "docker compose up" }),
      "DOCKER_UNAVAILABLE",
    );
  }
}

/**
 * Resolve and validate the proxy_engine input.
 * Only "transparent" (default) and "explicit" are accepted — each maps to a
 * separately published, separately tagged Docker image (see
 * lib/verify-image.js's imageTagFromRef).
 */
export function resolveProxyEngine(input: string | undefined): "transparent" | "explicit" {
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
 * Rethrow a rule-parser's syntax errors as a SetupError with the shared
 * INVALID_RULES code.
 */
function parseRulesOrThrow(rulesInput: string | undefined): string[] {
  try {
    return parseAndValidateRules(rulesInput);
  } catch (e) {
    throw new SetupError((e as Error).message, "INVALID_RULES");
  }
}

/**
 * Build ACL rules from input strings. Rules are passed through as-is
 * (wildcard format), validated eagerly.
 */
export function buildACLRules({
  httpsRulesInput,
  httpRulesInput,
  ipRulesInput,
}: {
  httpsRulesInput: string | undefined;
  httpRulesInput: string | undefined;
  ipRulesInput: string | undefined;
}): { httpsRules: string[]; httpRules: string[]; ipRules: string[] } {
  return {
    httpsRules: parseRulesOrThrow(httpsRulesInput),
    httpRules: parseRulesOrThrow(httpRulesInput),
    ipRules: parseRulesOrThrow(ipRulesInput),
  };
}

function logRules(label: string, rules: string[]): void {
  console.log(`${label} rules:${rules.length === 0 ? " (none)" : ""}`);
  for (const r of rules) console.log(`  ${r}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    if (err instanceof ActionError) {
      console.log(`::error::${err.message}`);
    } else {
      console.log(`::error::Unexpected error in setup: ${err.message}`);
    }
    process.exit(1);
  });
}

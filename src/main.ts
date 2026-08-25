import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@actions/core";

import { SetupError } from "./lib/errors.ts";
import { ActionError, errorMessage } from "#core/lib/errors.ts";
import { buildACLRules, parseRulesOrThrow } from "#core/lib/acl/rules.ts";
import { buildUrlRules } from "#core/lib/acl/url-rules.ts";
import {
  verifyImageDigestOrThrow,
  type VerifyImageDigestOptions,
  type ResolvedImage,
} from "#core/lib/provenance/verify-image.ts";
import { resolveBuildcageImageRef } from "#core/lib/provenance/image-ref.ts";
import { describeDockerFailure } from "#core/lib/actions/docker-error.ts";
import { logRules } from "#core/lib/actions/log.ts";
import { deriveProjectName } from "#core/lib/docker/compose-project-name.ts";
import { buildComposeUpArgs, buildComposeDownArgs } from "#core/lib/docker/args.ts";

export { buildACLRules };

const __dirname = dirname(fileURLToPath(import.meta.url));
const composeFile = join(__dirname, "../docker/compose.action.yaml");

// Gates a local-image override used only by this repo's own CI/dev testing
// (see test_action in .github/workflows/test-e2e.yml), never by a consumer of
// a published action. A normal build physically excludes
// src/core/lib/provenance/local-image-override.ts (rolldown tree-shakes the dead import); the
// unit_test CI job also greps the built output as a backstop.
const LOCAL_IMAGE_OVERRIDE_ENABLED = process.env.BUILDCAGE_BUILD_TEST_HOOKS === "1";

/**
 * Verifies image provenance and resolves the digest-pinned image ref.
 * Throws ProvenanceError("UNVERIFIABLE_REF") if verification can't be
 * performed (branch ref / local ./) — printed by the top-level catch.
 */
async function resolveVerifiedImage({
  actionRef,
  actionRepo,
  proxyEngine,
}: VerifyImageDigestOptions): Promise<ResolvedImage> {
  const digest = await verifyImageDigestOrThrow({ actionRef, actionRepo, proxyEngine });
  console.log(
    `Image provenance verified for ref: ${JSON.stringify(actionRef)} (digest ${digest}).`,
  );
  return {
    imageRef: resolveBuildcageImageRef({ imageDigest: digest, actionRepository: actionRepo }),
    pullPolicy: "always",
  };
}

async function main(): Promise<void> {
  const env = process.env;
  const actionRef = env.GITHUB_ACTION_REF ?? "";
  const actionRepo = env.GITHUB_ACTION_REPOSITORY ?? "";

  const proxyEngine = resolveProxyEngine(core.getInput("proxy_engine"));
  console.log(`Proxy engine: ${proxyEngine}`);

  const localOverride = LOCAL_IMAGE_OVERRIDE_ENABLED
    ? (await import("./core/lib/provenance/local-image-override.ts")).readLocalImageOverride(env)
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
  console.log(`buildcage: image: ${imageRef}`);

  const rules = buildACLRules({
    httpsRulesInput: core.getInput("allowed_https_rules"),
    httpRulesInput: core.getInput("allowed_http_rules"),
    ipRulesInput: core.getInput("allowed_ip_rules"),
  });
  const knownBlockedRules = parseRulesOrThrow(core.getInput("known_blocked_rules"));
  // Only inspect can enforce on a method or a path, so these are compiled here
  // purely to fail on a typo at setup rather than inside the container.
  const urlRulesInput = core.getInput("allowed_url_rules");
  const tlsRules = parseRulesOrThrow(core.getInput("allow_tls_rules"));
  const urlRules = buildUrlRules(urlRulesInput).map((r) => r.raw);
  if (proxyEngine !== "inspect" && (urlRules.length > 0 || tlsRules.length > 0)) {
    throw new SetupError(
      "allowed_url_rules and allow_tls_rules need proxy_engine: inspect. " +
        `The ${proxyEngine} engine cannot see a method or a path.`,
      "INVALID_PROXY_ENGINE",
    );
  }

  console.log("::group::buildcage: Configured ACL Rules");
  logRules("HTTPS", rules.httpsRules);
  logRules("HTTP", rules.httpRules);
  logRules("IP", rules.ipRules);
  logRules("URL", urlRules);
  logRules("TLS", tlsRules);
  logRules("Known blocked", knownBlockedRules);
  console.log("::endgroup::");

  // "buildcage" here is a fallback for running outside the Actions runtime
  // (action.yml's own `default: 'buildcage'` covers the normal case) — keep
  // both, and report/src/main.ts's copy, in sync.
  const builderName = core.getInput("builder_name") || "buildcage";
  // So report can independently derive the same project name from its own
  // builder_name input and find this container via `docker ps --filter`.
  const projectName = deriveProjectName(builderName);

  const composeEnv = {
    ...env,
    BUILDER_NAME: builderName,
    PROXY_MODE: core.getInput("proxy_mode") || "restrict",
    PROXY_ENGINE: proxyEngine,
    ALLOWED_HTTPS_RULES: rules.httpsRules.join("\n"),
    ALLOWED_HTTP_RULES: rules.httpRules.join("\n"),
    ALLOWED_IP_RULES: rules.ipRules.join("\n"),
    // Newline separated because a URL rule contains a space, unlike the others.
    ALLOWED_URL_RULES: urlRules.join("\n"),
    ALLOW_TLS_RULES: tlsRules.join("\n"),
    KNOWN_BLOCKED_RULES: knownBlockedRules.join("\n"),
    BUILDCAGE_IMAGE_REF: imageRef,
  };

  try {
    execFileSync("docker", buildComposeDownArgs({ composeFile, projectName }), {
      stdio: "inherit",
      env: composeEnv,
    });
  } catch (e) {
    throw new SetupError(
      describeDockerFailure(e, { operation: "docker compose down" }),
      "DOCKER_UNAVAILABLE",
    );
  }

  try {
    execFileSync("docker", buildComposeUpArgs({ composeFile, projectName, pullPolicy }), {
      stdio: "inherit",
      env: composeEnv,
    });
  } catch (e) {
    throw new SetupError(
      describeDockerFailure(e, { operation: "docker compose up" }),
      "DOCKER_UNAVAILABLE",
    );
  }
}

/**
 * Resolve and validate the proxy_engine input.
 * Each accepted value maps to a separately published, separately tagged
 * Docker image (see provenance/image-tag.ts's imageTagFromRef).
 */
const ENGINES = ["transparent", "explicit", "inspect"] as const;
export type ProxyEngine = (typeof ENGINES)[number];

export function resolveProxyEngine(input: string | undefined): ProxyEngine {
  const engine = input?.trim() || "transparent";
  if (!(ENGINES as readonly string[]).includes(engine)) {
    throw new SetupError(
      `Invalid proxy_engine: ${JSON.stringify(input)}. Must be one of ${ENGINES.join(", ")}.`,
      "INVALID_PROXY_ENGINE",
    );
  }
  return engine as ProxyEngine;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    if (err instanceof ActionError) {
      console.log(`::error::${err.message}`);
    } else {
      console.log(`::error::Unexpected error in setup: ${errorMessage(err)}`);
    }
    process.exit(1);
  });
}

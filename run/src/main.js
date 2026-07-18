import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { buildRules } from "../../core/shared/lib/rules.js";
import { resolveBuildcageImageRef } from "../../core/lib/image-ref.js";
import { verifyImageDigest } from "../../core/lib/verify-image.js";
import { SandboxError } from "./lib/errors.js";
import { generateContainerName, getContainerPid, deriveProjectName } from "./lib/container.js";
import { buildComposeUpArgs, buildComposeDownArgs } from "./lib/compose-args.js";
import { writeRunScript, runIsolated, withScratchDir } from "./lib/isolated-exec.js";
import { fetchReport, writeReport } from "./lib/report.js";

export { buildComposeUpArgs, buildComposeDownArgs };

const __dirname = dirname(fileURLToPath(import.meta.url));
const composeFile = join(__dirname, "../compose.yaml");

// Gates a local-image override used only by this repo's own CI/dev testing
// (see test_action in .github/workflows/test.yml), never by a consumer of a
// published action. Mirrors setup/src/main.js's LOCAL_IMAGE_OVERRIDE_ENABLED.
const LOCAL_IMAGE_OVERRIDE_ENABLED = process.env.BUILDCAGE_BUILD_TEST_HOOKS === "1";

/**
 * Verifies image provenance and resolves the digest-pinned image ref for
 * the run action's (buildkitd-less) proxy image, published under the `-proxy`
 * tag suffix (see imageTagFromRef in core/lib/verify-image.js).
 */
async function resolveVerifiedImage({ actionRef, actionRepo }) {
  let digest;
  try {
    digest = await verifyImageDigest({ actionRef, actionRepo, proxyEngine: "proxy" });
  } catch (e) {
    throw new SandboxError(e.message, e.code ?? "VERIFY_FAILED");
  }
  if (digest === null) {
    throw new SandboxError(
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

/**
 * Build ACL rules from input strings. Rules are passed through as-is
 * (wildcard format), validated by converting to regex.
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
    throw new SandboxError(e.message, "INVALID_RULES");
  }
  return { httpsRules, httpRules, ipRules };
}

/**
 * Parse the `writable` input into a list of directories. Newline-separated
 * (not whitespace-split like the ACL rule inputs above) since paths can
 * legitimately contain spaces.
 */
export function parseWritablePaths(input) {
  return (
    input
      ?.split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean) ?? []
  );
}

function logRules(label, rules) {
  console.log(`${label} rules:${rules.length === 0 ? " (none)" : ""}`);
  for (const r of rules) console.log(`  ${r}`);
}

async function main() {
  const env = process.env;
  const actionRef = env.GITHUB_ACTION_REF ?? "";
  const actionRepo = env.GITHUB_ACTION_REPOSITORY ?? "";

  const runInput = env.INPUT_RUN ?? "";
  if (!runInput.trim()) {
    throw new SandboxError("Input 'run' is required.", "MISSING_RUN");
  }

  const localOverride = LOCAL_IMAGE_OVERRIDE_ENABLED
    ? (await import("../../core/lib/local-image-override.js")).readLocalImageOverride(env)
    : null;
  if (localOverride) {
    console.log(
      `BUILDCAGE_LOCAL_IMAGE_REF is set (${JSON.stringify(localOverride.imageRef)}) — ` +
        `skipping image provenance verification entirely. This bypass exists only for ` +
        `buildcage's own CI self-tests and local development.`,
    );
  }
  const { imageRef, pullPolicy } = localOverride ?? (await resolveVerifiedImage({ actionRef, actionRepo }));
  console.log(`buildcage-proxy image: ${imageRef}`);

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

  const writablePaths = parseWritablePaths(env.INPUT_WRITABLE);

  // Each `run` step gets its own throwaway proxy container — start, run
  // the isolated command, report, and stop, all within this one step —
  // rather than sharing one across steps in the same job.
  const containerName = generateContainerName();
  const projectName = deriveProjectName(containerName);
  const stateFile = env.GITHUB_STATE;
  // Recorded so post.js can still clean up if this run is killed outright
  // before reaching its own finally block below.
  if (stateFile) {
    appendFileSync(stateFile, `container_name=${containerName}\n`);
    appendFileSync(stateFile, `project_name=${projectName}\n`);
  }

  const composeEnv = {
    ...env,
    PROXY_CONTAINER_NAME: containerName,
    PROXY_MODE: env.INPUT_PROXY_MODE || "restrict",
    ALLOWED_HTTPS_RULES: rules.httpsRules.join("\n"),
    ALLOWED_HTTP_RULES: rules.httpRules.join("\n"),
    ALLOWED_IP_RULES: rules.ipRules.join("\n"),
    BUILDCAGE_PROXY_IMAGE_REF: imageRef,
  };

  execFileSync(
    "docker",
    buildComposeUpArgs({ composeFile, projectName, pullPolicy }),
    { stdio: "inherit", env: composeEnv },
  );

  let exitCode = 1;
  try {
    const proxyPid = getContainerPid(containerName);
    if (proxyPid === null) {
      throw new SandboxError(`Sandbox proxy container ${containerName} is not running.`, "PROXY_NOT_RUNNING");
    }

    exitCode = withScratchDir((dir) => {
      const scriptPath = writeRunScript(runInput, dir);
      return runIsolated({
        scriptPath,
        proxyPid,
        workdir: env.GITHUB_WORKSPACE || "",
        home: env.HOME || "",
        writablePaths,
        env,
        runScriptDir: dir,
      });
    });
  } finally {
    try {
      const report = fetchReport(containerName);
      writeReport(report, {
        failOnBlocked: (env.INPUT_FAIL_ON_BLOCKED || "true").toLowerCase() === "true",
      });
    } catch (e) {
      console.log(`::warning::Failed to fetch sandbox report: ${e.message}`);
    }
    execFileSync("docker", buildComposeDownArgs({ composeFile, projectName }), { stdio: "inherit", env: composeEnv });
  }

  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    if (err instanceof SandboxError) {
      console.log(`::error::${err.message}`);
    } else {
      console.log(`::error::Unexpected error in sandbox: ${err.message}`);
    }
    process.exit(1);
  });
}

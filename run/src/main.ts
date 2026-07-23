// @ts-nocheck
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { parseAndValidateRules } from "../../core/shared/lib/rules.js";
import { resolveBuildcageImageRef } from "../../core/lib/provenance/image-ref.ts";
import { verifyImageDigestOrThrow } from "../../core/lib/provenance/verify-image.ts";
import { describeDockerFailure } from "../../core/lib/actions/docker-error.ts";
import { createAnnotation } from "../../core/lib/actions/annotation.ts";
import { ActionError } from "../../core/lib/general/action-error.ts";
import { SandboxError } from "./lib/errors.ts";
import { checkPasswordlessSudo } from "./lib/sudo-preflight.ts";
import { generateContainerName, getContainerPid, deriveProjectName } from "./lib/container.ts";
import { buildComposeUpArgs, buildComposeDownArgs } from "./lib/compose-args.ts";
import {
  writeRunScript,
  writeResolvConf,
  extractRuncBootstrap,
  buildOciConfig,
  writeOciConfig,
  runIsolated,
  withScratchDir,
  listHostMounts,
} from "./lib/isolated-exec.ts";
import { fetchReport, writeReport } from "./lib/report.ts";

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
 * tag suffix (see imageTagFromRef in core/lib/provenance/verify-image.js).
 */
async function resolveVerifiedImage({ actionRef, actionRepo }) {
  const digest = await verifyImageDigestOrThrow({ actionRef, actionRepo, proxyEngine: "proxy" });
  console.log(`Image provenance verified for ref: ${JSON.stringify(actionRef)} (digest ${digest}).`);
  return {
    imageRef: resolveBuildcageImageRef({ imageDigest: digest, actionRepository: actionRepo }),
    pullPolicy: "always",
  };
}

/**
 * Rethrow a rule-parser's syntax errors as a SandboxError with the shared
 * INVALID_RULES code, used by both buildACLRules and readKnownBlockedRules.
 */
function parseRulesOrThrow(rulesInput) {
  try {
    return parseAndValidateRules(rulesInput);
  } catch (e) {
    throw new SandboxError(e.message, "INVALID_RULES");
  }
}

/**
 * Build ACL rules from input strings. Rules are passed through as-is
 * (wildcard format), validated eagerly.
 */
export function buildACLRules({ httpsRulesInput, httpRulesInput, ipRulesInput }) {
  return {
    httpsRules: parseRulesOrThrow(httpsRulesInput),
    httpRules: parseRulesOrThrow(httpRulesInput),
    ipRules: parseRulesOrThrow(ipRulesInput),
  };
}

/**
 * Never sent to the container's ACL — see core/lib/report/known-blocked.js.
 */
export function readKnownBlockedRules(input) {
  return parseRulesOrThrow(input);
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
  // Empty (not `??`-catchable) for local-path `uses: ./run` invocations —
  // mirrors report/src/main.js's fallback for the same case.
  const actionRef = env.GITHUB_ACTION_REF || "v2";
  const actionRepo = env.GITHUB_ACTION_REPOSITORY || "dash14/buildcage";

  const runInput = env.INPUT_RUN ?? "";
  if (!runInput.trim()) {
    throw new SandboxError("Input 'run' is required.", "MISSING_RUN");
  }

  // Fail fast — before image verification or starting the proxy container —
  // if the runner can't support the isolation setup at all.
  checkPasswordlessSudo();

  // Same gate as writeReport() in lib/report.js — suppresses annotations
  // when this script isn't running as the real action.
  const annotation = createAnnotation(Boolean(env.GITHUB_STEP_SUMMARY));

  const localOverride = LOCAL_IMAGE_OVERRIDE_ENABLED
    ? (await import("../../core/lib/provenance/local-image-override.ts")).readLocalImageOverride(env)
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

  const knownBlockedRules = readKnownBlockedRules(env.INPUT_KNOWN_BLOCKED_RULES);

  console.log("::group::Configured ACL Rules");
  logRules("HTTPS", rules.httpsRules);
  logRules("HTTP", rules.httpRules);
  logRules("IP", rules.ipRules);
  logRules("Known-blocked (informational only, not sent to proxy ACL)", knownBlockedRules);
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

  try {
    execFileSync(
      "docker",
      buildComposeUpArgs({ composeFile, projectName, pullPolicy }),
      { stdio: "inherit", env: composeEnv },
    );
  } catch (e) {
    throw new SandboxError(
      describeDockerFailure(e, { operation: "docker compose up" }),
      "DOCKER_UNAVAILABLE",
    );
  }

  let exitCode = 1;
  try {
    const proxyPid = getContainerPid(containerName);
    if (proxyPid === null) {
      throw new SandboxError(`Sandbox proxy container ${containerName} is not running.`, "PROXY_NOT_RUNNING");
    }

    // Fixed addressing for the direct veth link to the proxy's sandbox0 interface.
    const gateway = "172.20.0.1";
    const dns = "172.20.0.1";
    const targetIp = "172.20.0.101";

    exitCode = withScratchDir((dir) => {
      let runcPath, seccompProfile, baseSpec;
      try {
        // Extracted into this run's own scratch dir — see extractRuncBootstrap.
        // Run natively on the runner host (not `docker exec`, which would
        // resolve against the container's kernel/arch instead of the real
        // one) — see gen-seccomp-profile/main.go.
        ({ runcPath, seccompProfile, baseSpec } = extractRuncBootstrap({ containerName, destDir: dir }));
      } catch (e) {
        throw new SandboxError(`Failed to extract runc/gen-seccomp-profile from the proxy image: ${e.message}`, "RUNC_EXTRACT_FAILED");
      }

      const workdir = env.GITHUB_WORKSPACE || "";
      const home = env.HOME || "";
      // Distinct from the Docker container name/Compose project name
      // (different ID namespace — `ip netns`/runc container IDs), but
      // derived from it to keep `ip netns`/`docker ps` output correlated
      // per step, same reasoning as deriveProjectName.
      const netnsName = containerName.replace(/^buildcage-proxy-/, "buildcage-sandbox-");
      const rootfsBindDir = join(dir, "rootfs");

      let config;
      try {
        const resolvConfPath = writeResolvConf(dns, dir);
        const scriptPath = writeRunScript(runInput, dir);
        // Real host mount table, read now (before run-isolated.sh's `mount
        // --rbind /` duplicates it into rootfsBindDir) so buildOciConfig can
        // force every real submount read-only individually -- root.readonly
        // alone only covers the top-level rootfs mount (see
        // computeReadonlyHostMounts).
        const hostMounts = listHostMounts();
        config = buildOciConfig(baseSpec, {
          uid: process.getuid(),
          gid: process.getgid(),
          workdir,
          home,
          // Standard writable runner scratch; not always under $HOME on
          // self-hosted runners, so covered explicitly (see buildOciConfig).
          runnerTemp: env.RUNNER_TEMP || "",
          writablePaths,
          env,
          netnsPath: `/var/run/netns/${netnsName}`,
          rootfsBindDir,
          resolvConfPath,
          seccompProfile,
          scriptPath,
          hostMounts,
        });
      } catch (e) {
        throw new SandboxError(`Failed to build the sandbox's OCI bundle: ${e.message}`, "OCI_CONFIG_BUILD_FAILED");
      }
      writeOciConfig(config, dir);

      return runIsolated({
        runcPath,
        proxyPid,
        bundleDir: dir,
        containerId: containerName,
        netnsName,
        rootfsBindDir,
        gateway,
        dns,
        targetIp,
      });
    }, containerName);
  } finally {
    try {
      const report = fetchReport(containerName);
      writeReport(report, {
        actionRepo,
        actionRef,
        runCommand: runInput,
        stepLabel: env.INPUT_LABEL || undefined,
        failOnBlocked: (env.INPUT_FAIL_ON_BLOCKED || "true").toLowerCase() === "true",
        knownBlockedRules,
      });
    } catch (e) {
      annotation.warning(`Failed to fetch sandbox report: ${e.message}`);
    }
    try {
      execFileSync("docker", buildComposeDownArgs({ composeFile, projectName }), { stdio: "inherit", env: composeEnv });
    } catch (e) {
      annotation.warning(
        `Failed to stop the sandbox proxy container: ${describeDockerFailure(e, { operation: "docker compose down" })}`,
      );
    }
  }

  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    if (err instanceof ActionError) {
      console.log(`::error::${err.message}`);
    } else {
      console.log(`::error::Unexpected error in sandbox: ${err.message}`);
    }
    process.exit(1);
  });
}

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@actions/core";

import { resolveBuildcageImageRef } from "../../core/lib/provenance/image-ref.ts";
import {
  verifyImageDigestOrThrow,
  type VerifyImageIdentity,
  type ResolvedImage,
} from "../../core/lib/provenance/verify-image.ts";
import { describeDockerFailure } from "../../core/lib/actions/docker-error.ts";
import { createAnnotation, type Annotation } from "../../core/lib/actions/annotation.ts";
import { ActionError } from "../../core/lib/general/action-error.ts";
import { errorMessage } from "../../core/lib/general/error-message.ts";
import { buildACLRules, parseRulesOrThrow } from "../../core/lib/acl/rules.ts";
import { SandboxError } from "./lib/errors.ts";
import { checkPasswordlessSudo } from "./lib/sudo-preflight.ts";
import { generateContainerName, getContainerPid } from "./lib/container.ts";
import { deriveProjectName } from "../../core/lib/docker/container.ts";
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
import {
  fetchReport,
  computeReportOutcome,
  type Report,
  type ComputeReportOutcomeOptions,
} from "./lib/report.ts";
import { writeStepSummary } from "../../setup/docker/lib/write-step-summary.ts";

export { buildComposeUpArgs, buildComposeDownArgs, buildACLRules };

const __dirname = dirname(fileURLToPath(import.meta.url));
const composeFile = join(__dirname, "../compose.yaml");

// Gates a local-image override used only by this repo's own CI/dev testing
// (see test_action in .github/workflows/test.yml), never by a consumer of a
// published action. Mirrors setup/src/main.ts's LOCAL_IMAGE_OVERRIDE_ENABLED.
const LOCAL_IMAGE_OVERRIDE_ENABLED = process.env.BUILDCAGE_BUILD_TEST_HOOKS === "1";

/**
 * Verifies image provenance and resolves the digest-pinned image ref for
 * the run action's (buildkitd-less) proxy image, published under the `-proxy`
 * tag suffix (see imageTagFromRef in core/lib/provenance/verify-image.ts).
 */
async function resolveVerifiedImage({
  actionRef,
  actionRepo,
}: VerifyImageIdentity): Promise<ResolvedImage> {
  const digest = await verifyImageDigestOrThrow({ actionRef, actionRepo, proxyEngine: "proxy" });
  console.log(
    `Image provenance verified for ref: ${JSON.stringify(actionRef)} (digest ${digest}).`,
  );
  return {
    imageRef: resolveBuildcageImageRef({ imageDigest: digest, actionRepository: actionRepo }),
    pullPolicy: "always",
  };
}

/**
 * Never sent to the container's ACL — used only for report-time annotation
 * of expected vs. unexpected blocked connections.
 */
export function readKnownBlockedRules(input: string | undefined): string[] {
  return parseRulesOrThrow(input);
}

/**
 * Parse the `writable` input into a list of directories. Newline-separated
 * (not whitespace-split like the ACL rule inputs above) since paths can
 * legitimately contain spaces.
 */
export function parseWritablePaths(input: string | undefined): string[] {
  return (
    input
      ?.split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean) ?? []
  );
}

function logRules(label: string, rules: string[]): void {
  console.log(`${label} rules:${rules.length === 0 ? " (none)" : ""}`);
  for (const r of rules) console.log(`  ${r}`);
}

/**
 * Wraps buildcage's own (non-user) log output in a collapsed
 * `::group::`/`::endgroup::` block, so a step's default (collapsed) view
 * shows only the user's own `run:` output — matching a plain `run:` step's
 * look. Always closes the group, even if `fn` throws, so a failure mid-group
 * can't leave it open for the rest of the step's output.
 */
async function withGroup<T>(label: string, fn: () => T | Promise<T>): Promise<T> {
  console.log(`::group::${label}`);
  try {
    return await fn();
  } finally {
    console.log("::endgroup::");
  }
}

/**
 * Side-effecting half of the report step: computeReportOutcome() decides
 * what to say, this writes it to the Job Summary/annotations/exit code.
 */
async function writeReportSummary(
  report: Report,
  annotation: Annotation,
  options: ComputeReportOutcomeOptions,
): Promise<void> {
  const outcome = computeReportOutcome(report, options);

  await writeStepSummary(outcome.markdown);

  // Debug-only mirror: GITHUB_STEP_SUMMARY is unique per step and can't be
  // reassigned, so a later step has no way to read this step's copy back.
  const debugSummaryFile = process.env.BUILDCAGE_RUN_DEBUG_SUMMARY_FILE;
  if (debugSummaryFile) {
    appendFileSync(debugSummaryFile, outcome.markdown);
  }

  if (outcome.level === "error") {
    annotation.error(outcome.message);
    process.exitCode = 1;
  } else if (outcome.level === "notice") {
    annotation.notice(outcome.message);
  }
}

async function main(): Promise<void> {
  const env = process.env;
  // Empty (not `??`-catchable) for local-path `uses: ./run` invocations —
  // mirrors report/src/main.ts's fallback for the same case.
  const actionRef = env.GITHUB_ACTION_REF || "v2";
  const actionRepo = env.GITHUB_ACTION_REPOSITORY || "dash14/buildcage";

  const runInput = core.getInput("run", { trimWhitespace: false });
  if (!runInput.trim()) {
    throw new SandboxError("Input 'run' is required.", "MISSING_RUN");
  }

  // Fail fast — before image verification or starting the proxy container —
  // if the runner can't support the isolation setup at all.
  checkPasswordlessSudo();

  // Same gate as writeReportSummary() below — suppresses annotations when
  // this script isn't running as the real action.
  const annotation = createAnnotation(Boolean(env.GITHUB_STEP_SUMMARY));

  const localOverride = LOCAL_IMAGE_OVERRIDE_ENABLED
    ? (await import("../../core/lib/provenance/local-image-override.ts")).readLocalImageOverride(
        env,
      )
    : null;
  if (localOverride) {
    console.log(
      `BUILDCAGE_LOCAL_IMAGE_REF is set (${JSON.stringify(localOverride.imageRef)}) — ` +
        `skipping image provenance verification entirely. This bypass exists only for ` +
        `buildcage's own CI self-tests and local development.`,
    );
  }
  const { imageRef, pullPolicy } =
    localOverride ?? (await resolveVerifiedImage({ actionRef, actionRepo }));
  console.log(`buildcage: proxy image: ${imageRef}`);

  const rules = buildACLRules({
    httpsRulesInput: core.getInput("allowed_https_rules"),
    httpRulesInput: core.getInput("allowed_http_rules"),
    ipRulesInput: core.getInput("allowed_ip_rules"),
  });
  const knownBlockedRules = readKnownBlockedRules(core.getInput("known_blocked_rules"));

  console.log("::group::buildcage: Configured ACL Rules");
  logRules("HTTPS", rules.httpsRules);
  logRules("HTTP", rules.httpRules);
  logRules("IP", rules.ipRules);
  logRules("Known-blocked (informational only, not sent to proxy ACL)", knownBlockedRules);
  console.log("::endgroup::");

  const writablePaths = parseWritablePaths(core.getInput("writable"));

  // Each `run` step gets its own throwaway proxy container — start, run
  // the isolated command, report, and stop, all within this one step —
  // rather than sharing one across steps in the same job.
  const containerName = generateContainerName();
  const projectName = deriveProjectName(containerName);
  // Recorded so post.ts can still clean up if this run is killed outright
  // before reaching its own finally block below.
  if (env.GITHUB_STATE) {
    core.saveState("container_name", containerName);
    core.saveState("project_name", projectName);
  }

  const composeEnv = {
    ...env,
    PROXY_CONTAINER_NAME: containerName,
    PROXY_MODE: core.getInput("proxy_mode") || "restrict",
    ALLOWED_HTTPS_RULES: rules.httpsRules.join("\n"),
    ALLOWED_HTTP_RULES: rules.httpRules.join("\n"),
    ALLOWED_IP_RULES: rules.ipRules.join("\n"),
    BUILDCAGE_PROXY_IMAGE_REF: imageRef,
  };

  await withGroup("buildcage: starting sandbox proxy", () => {
    try {
      execFileSync("docker", buildComposeUpArgs({ composeFile, projectName, pullPolicy }), {
        stdio: "inherit",
        env: composeEnv,
      });
    } catch (e) {
      throw new SandboxError(
        describeDockerFailure(e, { operation: "docker compose up" }),
        "DOCKER_UNAVAILABLE",
      );
    }
  });

  let exitCode = 1;
  try {
    const proxyPid = getContainerPid(containerName);
    if (proxyPid === null) {
      throw new SandboxError(
        `Sandbox proxy container ${containerName} is not running.`,
        "PROXY_NOT_RUNNING",
      );
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
        ({ runcPath, seccompProfile, baseSpec } = extractRuncBootstrap({
          containerName,
          destDir: dir,
        }));
      } catch (e) {
        throw new SandboxError(
          `Failed to extract runc/gen-seccomp-profile from the proxy image: ${errorMessage(e)}`,
          "RUNC_EXTRACT_FAILED",
        );
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
          identity: { uid: process.getuid!(), gid: process.getgid!() },
          writable: {
            workdir,
            home,
            // Standard writable runner scratch; not always under $HOME on
            // self-hosted runners, so covered explicitly (see buildOciConfig).
            runnerTemp: env.RUNNER_TEMP || "",
            writablePaths,
          },
          runtime: {
            netnsPath: `/var/run/netns/${netnsName}`,
            rootfsBindDir,
            resolvConfPath,
            seccompProfile,
            scriptPath,
            hostMounts,
          },
          env,
        });
      } catch (e) {
        throw new SandboxError(
          `Failed to build the sandbox's OCI bundle: ${errorMessage(e)}`,
          "OCI_CONFIG_BUILD_FAILED",
        );
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
      const report = await fetchReport(containerName, {
        mode: core.getInput("proxy_mode") || "restrict",
        allowedHttpsRules: rules.httpsRules,
        allowedHttpRules: rules.httpRules,
        allowedIpRules: rules.ipRules,
        knownBlockedRules,
      });
      // Several integration scripts invoke this action directly without
      // setting fail_on_blocked, unlike a real workflow where action.yml's
      // own default always supplies it — fall back to that same default.
      let failOnBlocked: boolean;
      try {
        failOnBlocked = core.getBooleanInput("fail_on_blocked");
      } catch {
        failOnBlocked = true;
      }
      await writeReportSummary(report, annotation, {
        actionRepo,
        actionRef,
        runCommand: runInput,
        stepLabel: core.getInput("label") || undefined,
        failOnBlocked,
      });
    } catch (e) {
      annotation.warning(`Failed to fetch sandbox report: ${errorMessage(e)}`);
    }
    await withGroup("buildcage: stopping sandbox proxy", () => {
      try {
        execFileSync("docker", buildComposeDownArgs({ composeFile, projectName }), {
          stdio: "inherit",
          env: composeEnv,
        });
      } catch (e) {
        annotation.warning(
          `Failed to stop the sandbox proxy container: ${describeDockerFailure(e, { operation: "docker compose down" })}`,
        );
      }
    });
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
      console.log(`::error::Unexpected error in sandbox: ${errorMessage(err)}`);
    }
    process.exit(1);
  });
}

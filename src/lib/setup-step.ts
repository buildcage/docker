/**
 * The whole setup step, in the order its parts have to happen in.
 *
 * Its own module rather than the entry point's body because almost none of
 * this is wiring: the engine decides which image tag is resolved, which of
 * the two input reads runs first decides which error a doubly-misconfigured
 * workflow is told about, and the teardown before the start is what keeps a
 * previous run's builder from being inherited. Those orderings are only
 * visible from here, so this is where they are tested.
 */

import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { SetupError } from "./errors.ts";
import { annotate } from "#core/lib/actions/annotation.ts";
import { readBuilderName, readEngineInputs, readRuleInputs } from "./inputs.ts";
import {
  checkIpRuleSupport,
  checkKnownBlockedUrlRuleSupport,
  checkUrlAndTlsRuleSupport,
} from "./engine-rule-support.ts";
import { isKnownBlockedUrlRule } from "#core/lib/acl/wildcard-rules.ts";
import { buildComposeEnv } from "./compose-env.ts";
import {
  verifyImageDigestOrThrow,
  type VerifyImageDigestOptions,
  type ResolvedImage,
} from "#core/lib/provenance/verify-image.ts";
import { resolveBuildcageImageRef } from "#core/lib/provenance/image-ref.ts";
import { describeDockerFailure } from "#core/lib/actions/docker-error.ts";
import { logRules, withLogGroup } from "#core/lib/actions/log.ts";
import { deriveProjectName } from "#core/lib/docker/compose-project-name.ts";
import { buildComposeUpArgs, buildComposeDownArgs } from "#core/lib/docker/args.ts";
import { readLocalImageOverride } from "./local-image.ts";
import { builderStartError } from "./builder-diagnostics.ts";

// Resolved from the bundle's own location: dist/main.cjs sits one directory
// above docker/.
const __dirname = dirname(fileURLToPath(import.meta.url));
export const COMPOSE_FILE = join(__dirname, "../docker/compose.action.yaml");

/**
 * The steps this function sequences. Declared rather than imported straight
 * into the body so a test can watch the order and the arguments without
 * standing in for a dozen modules at once; each one is tested in its own file.
 *
 * Pure steps are left out on purpose and run for real (deriveProjectName,
 * buildComposeEnv, resolveBuildcageImageRef, describeDockerFailure, and the
 * argv builders): what a test wants to see of those is the value that reached
 * the next step, not the call.
 */
export interface SetupStepDeps {
  readEngineInputs: typeof readEngineInputs;
  readRuleInputs: typeof readRuleInputs;
  readBuilderName: typeof readBuilderName;
  readLocalImageOverride: typeof readLocalImageOverride;
  verifyImageDigestOrThrow: typeof verifyImageDigestOrThrow;
  checkUrlAndTlsRuleSupport: typeof checkUrlAndTlsRuleSupport;
  checkKnownBlockedUrlRuleSupport: typeof checkKnownBlockedUrlRuleSupport;
  checkIpRuleSupport: typeof checkIpRuleSupport;
  logRules: typeof logRules;
  withLogGroup: typeof withLogGroup;
  builderStartError: typeof builderStartError;
  /** `docker <args>` with stdio inherited: compose's own progress output is
   *  what the job log wants to show. */
  runDocker: (args: string[], env: NodeJS.ProcessEnv) => void;
  log: (message: string) => void;
  /** The rule-support warning goes to the always-on emitter: this action has no
   *  report of its own to suppress it alongside. */
  warn: (message: string) => void;
}

// Untested by design: the default behind the seam above, which only hands
// execFileSync what the tested caller decided.
/* v8 ignore start */
const runDockerViaExec = (args: string[], env: NodeJS.ProcessEnv): void => {
  execFileSync("docker", args, { stdio: "inherit", env });
};
/* v8 ignore stop */

const realDeps: SetupStepDeps = {
  readEngineInputs,
  readRuleInputs,
  readBuilderName,
  readLocalImageOverride,
  verifyImageDigestOrThrow,
  checkUrlAndTlsRuleSupport,
  checkKnownBlockedUrlRuleSupport,
  checkIpRuleSupport,
  logRules,
  withLogGroup,
  builderStartError,
  runDocker: runDockerViaExec,
  log: console.log,
  warn: annotate.warning,
};

/**
 * Verifies image provenance and resolves the digest-pinned image ref.
 * Throws ProvenanceError("UNVERIFIABLE_REF") if verification can't be
 * performed (branch ref, local ./), printed by the top-level catch.
 */
async function resolveVerifiedImage(
  { actionRef, actionRepo, proxyEngine }: VerifyImageDigestOptions,
  { verifyImageDigestOrThrow, log }: Pick<SetupStepDeps, "verifyImageDigestOrThrow" | "log">,
): Promise<ResolvedImage> {
  const digest = await verifyImageDigestOrThrow({ actionRef, actionRepo, proxyEngine });
  log(`Image provenance verified for ref: ${JSON.stringify(actionRef)} (digest ${digest}).`);
  return {
    imageRef: resolveBuildcageImageRef({ imageDigest: digest, actionRepository: actionRepo }),
    pullPolicy: "always",
  };
}

/**
 * Runs the setup step start to finish, leaving a builder the build steps that
 * follow can use. Anything that stops that builder from coming up rejects.
 */
export async function runSetupStep(
  env: NodeJS.ProcessEnv,
  overrides: Partial<SetupStepDeps> = {},
): Promise<void> {
  const {
    readEngineInputs,
    readRuleInputs,
    readBuilderName,
    readLocalImageOverride,
    verifyImageDigestOrThrow,
    checkUrlAndTlsRuleSupport,
    checkKnownBlockedUrlRuleSupport,
    checkIpRuleSupport,
    logRules,
    withLogGroup,
    builderStartError,
    runDocker,
    log,
    warn,
  } = { ...realDeps, ...overrides };

  const actionRef = env.GITHUB_ACTION_REF ?? "";
  const actionRepo = env.GITHUB_ACTION_REPOSITORY ?? "";

  // Read before the image: each engine has its own image tag.
  const { proxyEngine } = readEngineInputs();
  log(`Proxy engine: ${proxyEngine}`);

  const localOverride = await readLocalImageOverride(env, log);
  const { imageRef, pullPolicy } =
    localOverride ??
    (await resolveVerifiedImage(
      { actionRef, actionRepo, proxyEngine },
      { verifyImageDigestOrThrow, log },
    ));
  log(`buildcage: image: ${imageRef}`);

  // Read after the image, not alongside the engine, so a run with both
  // problems reports the image error (see inputs.ts).
  const {
    proxyMode,
    failOnCaResidue,
    httpsRules,
    httpRules,
    ipRules,
    urlRules,
    tlsRules,
    knownBlockedRules,
  } = readRuleInputs();
  // Before the builder starts, so a rule the engine cannot enforce is reported
  // once, up front, rather than silently not enforced.
  checkUrlAndTlsRuleSupport({ proxyEngine, proxyMode, urlRules, tlsRules }, warn);
  checkKnownBlockedUrlRuleSupport(
    {
      proxyEngine,
      proxyMode,
      knownBlockedUrlRules: knownBlockedRules.filter(isKnownBlockedUrlRule),
    },
    warn,
  );
  checkIpRuleSupport({ proxyEngine, proxyMode, ipRules }, warn);

  withLogGroup("buildcage: Configured ACL Rules", () => {
    logRules("HTTPS", httpsRules);
    logRules("HTTP", httpRules);
    logRules("IP", ipRules);
    logRules("URL", urlRules);
    logRules("TLS", tlsRules);
    logRules("Known blocked", knownBlockedRules);
  });

  const builderName = readBuilderName();
  // So report can independently derive the same project name from its own
  // builder_name input and find this container via `docker ps --filter`.
  const projectName = deriveProjectName(builderName);

  const composeEnv = buildComposeEnv(
    {
      builderName,
      proxyMode,
      proxyEngine,
      failOnCaResidue,
      imageRef,
      httpsRules,
      httpRules,
      ipRules,
      urlRules,
      tlsRules,
      knownBlockedRules,
    },
    env,
  );

  // Always before the `up`: a builder a previous run left behind carries that
  // run's ACL rules, and compose would keep it rather than recreate it.
  try {
    runDocker(buildComposeDownArgs({ composeFile: COMPOSE_FILE, projectName }), composeEnv);
  } catch (e) {
    throw new SetupError(
      describeDockerFailure(e, { operation: "docker compose down" }),
      "DOCKER_UNAVAILABLE",
    );
  }

  try {
    runDocker(
      buildComposeUpArgs({ composeFile: COMPOSE_FILE, projectName, pullPolicy }),
      composeEnv,
    );
  } catch (e) {
    throw builderStartError(e, {
      composeFile: COMPOSE_FILE,
      projectName,
      builderName,
      composeEnv,
    });
  }
}

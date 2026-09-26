import { describe, it, expect, vi, beforeEach } from "vitest";

import { runSetupStep, COMPOSE_FILE, type SetupStepDeps } from "./setup-step.ts";
import { SetupError } from "./errors.ts";

// Every collaborator is tested in its own file; what is left to check here is
// the order they run in, what each one is handed, and which of them still run
// when an earlier step fails.
const mocks = {
  readEngineInputs: vi.fn(),
  readRuleInputs: vi.fn(),
  readBuilderName: vi.fn(),
  readLocalImageOverride: vi.fn(),
  verifyImageDigestOrThrow: vi.fn(),
  checkUrlAndTlsRuleSupport: vi.fn(),
  checkKnownBlockedUrlRuleSupport: vi.fn(),
  checkIpRuleSupport: vi.fn(),
  logRules: vi.fn(),
  withLogGroup: vi.fn(),
  builderStartError: vi.fn(),
  runDocker: vi.fn(),
  log: vi.fn(),
  warn: vi.fn(),
};

// A bag of doubles, not a partially-typed stand-in: every step is replaced, so
// the cast says what the shape already is.
const deps = mocks as unknown as SetupStepDeps;

const DIGEST = "sha256:" + "a".repeat(64);

const ENV = {
  GITHUB_ACTION_REF: "v3.2.1",
  GITHUB_ACTION_REPOSITORY: "buildcage/docker",
};

/** `buildcage-` + the first 12 hex of sha256("buildcage"): the same name
 *  report derives from its own builder_name input. */
const PROJECT_NAME = "buildcage-eeb358f947ee";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.readEngineInputs.mockReturnValue({ proxyEngine: "universal" });
  mocks.readRuleInputs.mockReturnValue({
    proxyMode: "restrict",
    failOnCaResidue: true,
    httpsRules: ["example.com:443"],
    httpRules: [],
    ipRules: [],
    urlRules: [],
    tlsRules: [],
    knownBlockedRules: [],
  });
  mocks.readBuilderName.mockReturnValue("buildcage");
  mocks.readLocalImageOverride.mockResolvedValue(null);
  mocks.verifyImageDigestOrThrow.mockResolvedValue(DIGEST);
  // The real one runs the callback; a test that cares asserts on logRules.
  mocks.withLogGroup.mockImplementation((_title: string, fn: () => void) => fn());
  mocks.builderStartError.mockReturnValue(
    new SetupError("builder never came up", "BUILDER_NOT_READY"),
  );
});

/** Call order of a step that ran, for comparing two steps against each other. */
function orderOf(mock: { mock: { invocationCallOrder: number[] } }): number {
  const [first] = mock.mock.invocationCallOrder;
  expect(first).toBeDefined();
  return first!;
}

/** The argv of the nth `docker` invocation. */
function dockerArgs(n: number): string[] {
  return mocks.runDocker.mock.calls[n]![0] as string[];
}

describe("runSetupStep", () => {
  // The image tag is per-engine, so the engine has to be known before
  // anything resolves an image.
  it("reads the engine before it resolves the image", async () => {
    await runSetupStep(ENV, deps);

    expect(orderOf(mocks.readEngineInputs)).toBeLessThan(orderOf(mocks.readLocalImageOverride));
    expect(orderOf(mocks.readEngineInputs)).toBeLessThan(orderOf(mocks.verifyImageDigestOrThrow));
    expect(mocks.verifyImageDigestOrThrow).toHaveBeenCalledWith({
      actionRef: "v3.2.1",
      actionRepo: "buildcage/docker",
      proxyEngine: "universal",
    });
  });

  // A local-path `uses: ./` invocation sets neither, and an empty ref is
  // exactly what provenance verification refuses on.
  it("hands verification an empty ref and repository when the runner names neither", async () => {
    await runSetupStep({}, deps);

    expect(mocks.verifyImageDigestOrThrow.mock.calls[0]![0]).toMatchObject({
      actionRef: "",
      actionRepo: "",
    });
  });

  // Folding the two input reads into one would move rule validation ahead of
  // image verification, changing which error a run with both problems reports.
  it("validates the rules only after the image has been verified", async () => {
    await runSetupStep(ENV, deps);

    expect(orderOf(mocks.verifyImageDigestOrThrow)).toBeLessThan(orderOf(mocks.readRuleInputs));
  });

  it("reports an unverifiable image without reading the rules at all", async () => {
    mocks.verifyImageDigestOrThrow.mockRejectedValue(new Error("no signature found"));

    await expect(runSetupStep(ENV, deps)).rejects.toThrow("no signature found");
    expect(mocks.readRuleInputs).not.toHaveBeenCalled();
    expect(mocks.runDocker).not.toHaveBeenCalled();
  });

  // A rule the engine cannot enforce has to be reported before the build steps
  // start running against a builder that silently ignores it.
  it("checks rule support against the engine before the builder starts", async () => {
    await runSetupStep(ENV, deps);

    expect(mocks.checkUrlAndTlsRuleSupport.mock.calls[0]![0]).toStrictEqual({
      proxyEngine: "universal",
      proxyMode: "restrict",
      urlRules: [],
      tlsRules: [],
    });
    expect(orderOf(mocks.checkUrlAndTlsRuleSupport)).toBeLessThan(orderOf(mocks.runDocker));
  });

  it("checks known_blocked_rules URL lines against the engine, host lines excluded", async () => {
    mocks.readRuleInputs.mockReturnValue({
      proxyMode: "restrict",
      failOnCaResidue: true,
      httpsRules: [],
      httpRules: [],
      ipRules: [],
      urlRules: [],
      tlsRules: [],
      knownBlockedRules: ["telemetry.example.com:*", "POST https://api.example.com/telemetry"],
    });

    await runSetupStep(ENV, deps);

    expect(mocks.checkKnownBlockedUrlRuleSupport.mock.calls[0]![0]).toStrictEqual({
      proxyEngine: "universal",
      proxyMode: "restrict",
      knownBlockedUrlRules: ["POST https://api.example.com/telemetry"],
    });
    expect(mocks.checkKnownBlockedUrlRuleSupport.mock.calls[0]![1]).toBe(mocks.warn);
    expect(orderOf(mocks.checkKnownBlockedUrlRuleSupport)).toBeLessThan(orderOf(mocks.runDocker));
  });

  it("checks allowed_ip_rules against the engine before the builder starts", async () => {
    mocks.readRuleInputs.mockReturnValue({
      proxyMode: "restrict",
      failOnCaResidue: true,
      httpsRules: [],
      httpRules: [],
      ipRules: ["10.0.0.0/8:443"],
      urlRules: [],
      tlsRules: [],
      knownBlockedRules: [],
    });

    await runSetupStep(ENV, deps);

    expect(mocks.checkIpRuleSupport.mock.calls[0]![0]).toStrictEqual({
      proxyEngine: "universal",
      proxyMode: "restrict",
      ipRules: ["10.0.0.0/8:443"],
    });
    expect(mocks.checkIpRuleSupport.mock.calls[0]![1]).toBe(mocks.warn);
    expect(orderOf(mocks.checkIpRuleSupport)).toBeLessThan(orderOf(mocks.runDocker));
  });

  it("pulls the image by verified digest, under the action's own repository", async () => {
    await runSetupStep(ENV, deps);

    expect(dockerArgs(1)).toStrictEqual(
      expect.arrayContaining(["up", "-d", "--pull", "always", "--no-build"]),
    );
    expect(mocks.runDocker.mock.calls[1]![1]).toMatchObject({
      BUILDCAGE_IMAGE_REF: `ghcr.io/buildcage/docker@${DIGEST}`,
    });
  });

  it("skips provenance verification when a local override names an image", async () => {
    mocks.readLocalImageOverride.mockResolvedValue({ imageRef: "local:dev", pullPolicy: "never" });

    await runSetupStep(ENV, deps);

    expect(mocks.verifyImageDigestOrThrow).not.toHaveBeenCalled();
    expect(dockerArgs(1)).toStrictEqual(expect.arrayContaining(["--pull", "never"]));
    expect(mocks.runDocker.mock.calls[1]![1]).toMatchObject({ BUILDCAGE_IMAGE_REF: "local:dev" });
  });

  // The rule-support warning goes to the emitter nothing can suppress.
  it("sends the rule-support warning to the always-on emitter", async () => {
    await runSetupStep(ENV, deps);

    expect(mocks.checkUrlAndTlsRuleSupport.mock.calls[0]![1]).toBe(mocks.warn);
  });

  it("hands the builder the rules that were read, not the job environment's", async () => {
    mocks.readRuleInputs.mockReturnValue({
      proxyMode: "audit",
      failOnCaResidue: false,
      httpsRules: ["example.com:443", "*.npmjs.org:443"],
      httpRules: ["deb.debian.org:80"],
      ipRules: ["10.0.0.0/8"],
      urlRules: ["GET https://example.com/ok"],
      tlsRules: ["example.com"],
      knownBlockedRules: ["blocked.example:443"],
    });

    await runSetupStep({ ...ENV, PROXY_MODE: "restrict", ALLOWED_HTTP_RULES: "leaked:80" }, deps);

    expect(mocks.runDocker.mock.calls[0]![1]).toMatchObject({
      PROXY_MODE: "audit",
      PROXY_ENGINE: "universal",
      BUILDER_NAME: "buildcage",
      ALLOWED_HTTPS_RULES: "example.com:443\n*.npmjs.org:443",
      ALLOWED_HTTP_RULES: "deb.debian.org:80",
      ALLOWED_IP_RULES: "10.0.0.0/8",
      ALLOWED_URL_RULES: "GET https://example.com/ok",
      ALLOWED_TLS_RULES: "example.com",
      KNOWN_BLOCKED_RULES: "blocked.example:443",
      FAIL_ON_CA_RESIDUE: "false",
    });
  });

  it("logs every rule list the builder was configured with", async () => {
    await runSetupStep(ENV, deps);

    expect(mocks.logRules.mock.calls.map(([label]) => label)).toStrictEqual([
      "HTTPS",
      "HTTP",
      "IP",
      "URL",
      "TLS",
      "Known blocked",
    ]);
  });

  describe("the builder container", () => {
    // Compose keeps a container that is already up rather than recreating it,
    // so a builder a previous run left behind would serve this run with the
    // previous run's ACL rules.
    it("is torn down before it is started", async () => {
      await runSetupStep(ENV, deps);

      expect(mocks.runDocker).toHaveBeenCalledTimes(2);
      expect(dockerArgs(0)).toStrictEqual([
        "compose",
        "-f",
        COMPOSE_FILE,
        "-p",
        PROJECT_NAME,
        "down",
      ]);
      expect(dockerArgs(1)[5]).toBe("up");
    });

    // report derives the same name from its own builder_name input to find
    // this container with `docker ps --filter`.
    it("runs under the project name report derives from the same builder name", async () => {
      await runSetupStep(ENV, deps);

      expect(dockerArgs(0)).toContain(PROJECT_NAME);
      expect(dockerArgs(1)).toContain(PROJECT_NAME);
    });

    it("is never started when the teardown itself fails", async () => {
      mocks.runDocker.mockImplementationOnce(() => {
        throw Object.assign(new Error("Command failed"), { code: "ENOENT" });
      });

      const error = await runSetupStep(ENV, deps).catch((e: SetupError) => e);

      expect(error).toBeInstanceOf(SetupError);
      expect((error as SetupError).code).toBe("DOCKER_UNAVAILABLE");
      expect((error as SetupError).message).toContain("docker compose down");
      expect(mocks.runDocker).toHaveBeenCalledTimes(1);
    });

    // builder-diagnostics asks the container itself why it failed; all this
    // step decides is that it is the one to ask.
    it("asks the diagnostics for the error when it fails to come up", async () => {
      const cause = new Error("dependency failed to start");
      mocks.runDocker
        .mockImplementationOnce(() => {})
        .mockImplementationOnce(() => {
          throw cause;
        });

      await expect(runSetupStep(ENV, deps)).rejects.toThrow("builder never came up");
      expect(mocks.builderStartError.mock.calls[0]![0]).toBe(cause);
      expect(mocks.builderStartError.mock.calls[0]![1]).toMatchObject({
        composeFile: COMPOSE_FILE,
        projectName: PROJECT_NAME,
        builderName: "buildcage",
      });
    });
  });
});

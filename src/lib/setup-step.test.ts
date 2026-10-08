import { describe, it, expect, vi, beforeEach } from "vitest";

import { SetupError } from "./errors.ts";
import { runSetupStep, COMPOSE_FILE, type SetupStepDeps } from "./setup-step.ts";

// Every collaborator is tested in its own file; what is left to check here is
// the order they run in, what each one is handed, and which of them still run
// when an earlier step fails.
const mocks = {
  applyConfigFile: vi.fn(),
  readSetupInputs: vi.fn(),
  readLocalImageOverride: vi.fn(),
  verifyImageDigestOrThrow: vi.fn(),
  checkUrlAndTlsRuleSupport: vi.fn(),
  checkKnownBlockedUrlRuleSupport: vi.fn(),
  logRules: vi.fn(),
  withLogGroup: vi.fn(),
  builderStartError: vi.fn(),
  runDocker: vi.fn(),
  saveState: vi.fn(),
  setOutput: vi.fn(),
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
  mocks.readSetupInputs.mockReturnValue(inputsWith());
  mocks.readLocalImageOverride.mockResolvedValue(null);
  mocks.verifyImageDigestOrThrow.mockResolvedValue(DIGEST);
  // The real one runs the callback; a test that cares asserts on logRules.
  mocks.withLogGroup.mockImplementation((_title: string, fn: () => void) => fn());
  mocks.builderStartError.mockReturnValue(
    new SetupError("builder never came up", "BUILDER_NOT_READY"),
  );
});

/** What readSetupInputs returns, with `overrides` on top of a minimal run. */
function inputsWith(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    proxyEngine: "universal",
    builderName: "buildcage",
    proxyMode: "restrict",
    failOnCaResidue: true,
    httpsRules: ["example.com:443"],
    httpRules: [],
    ipRules: [],
    urlRules: [],
    tlsRules: [],
    knownBlockedRules: [],
    ...overrides,
  };
}

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
  it("saves the builder name for post before starting the builder", async () => {
    mocks.readSetupInputs.mockReturnValue(inputsWith({ builderName: "from-file" }));

    await runSetupStep({ ...ENV, GITHUB_STATE: "/tmp/state" }, deps);

    expect(mocks.saveState).toHaveBeenCalledWith("builder_name", "from-file");
    expect(orderOf(mocks.saveState)).toBeLessThan(orderOf(mocks.runDocker));
  });

  it("saves nothing when the runner set no state file", async () => {
    await runSetupStep(ENV, deps);

    expect(mocks.saveState).not.toHaveBeenCalled();
  });

  it("outputs the builder name before starting the builder", async () => {
    mocks.readSetupInputs.mockReturnValue(inputsWith({ builderName: "from-file" }));

    await runSetupStep(ENV, deps);

    expect(mocks.setOutput).toHaveBeenCalledWith("builder_name", "from-file");
    expect(orderOf(mocks.setOutput)).toBeLessThan(orderOf(mocks.runDocker));
  });

  it("applies config_file to the step's env before reading any input, and logs it", async () => {
    mocks.applyConfigFile.mockReturnValue({
      path: "/home/runner/work/repo/repo/c.yml",
      summary: ["Inputs read from config_file c.yml:", "  proxy_mode"],
    });

    await runSetupStep(ENV, deps);

    expect(mocks.applyConfigFile).toHaveBeenCalledWith(
      ENV,
      expect.objectContaining({ known: expect.arrayContaining(["builder_name"]) }),
    );
    expect(orderOf(mocks.applyConfigFile)).toBeLessThan(orderOf(mocks.readSetupInputs));
    expect(mocks.log).toHaveBeenCalledWith("Inputs read from config_file c.yml:");
    expect(mocks.log).toHaveBeenCalledWith("  proxy_mode");
  });

  // The image tag is per-engine, so the engine has to be known before
  // anything resolves an image.
  it("reads the engine before it resolves the image", async () => {
    await runSetupStep(ENV, deps);

    expect(orderOf(mocks.readSetupInputs)).toBeLessThan(orderOf(mocks.readLocalImageOverride));
    expect(orderOf(mocks.readSetupInputs)).toBeLessThan(orderOf(mocks.verifyImageDigestOrThrow));
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

  // A typo in an input fails without waiting on verification's network calls.
  it("reports invalid inputs before it resolves the image", async () => {
    mocks.readSetupInputs.mockImplementation(() => {
      throw new Error("Invalid rule");
    });

    await expect(runSetupStep(ENV, deps)).rejects.toThrow("Invalid rule");
    expect(mocks.readLocalImageOverride).not.toHaveBeenCalled();
    expect(mocks.verifyImageDigestOrThrow).not.toHaveBeenCalled();
    expect(mocks.runDocker).not.toHaveBeenCalled();
  });

  it("starts no builder when the image cannot be verified", async () => {
    mocks.verifyImageDigestOrThrow.mockRejectedValue(new Error("no signature found"));

    await expect(runSetupStep(ENV, deps)).rejects.toThrow("no signature found");
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
    mocks.readSetupInputs.mockReturnValue(
      inputsWith({
        httpsRules: [],
        knownBlockedRules: ["telemetry.example.com:*", "POST https://api.example.com/telemetry"],
      }),
    );

    await runSetupStep(ENV, deps);

    expect(mocks.checkKnownBlockedUrlRuleSupport.mock.calls[0]![0]).toStrictEqual({
      proxyEngine: "universal",
      proxyMode: "restrict",
      knownBlockedUrlRules: ["POST https://api.example.com/telemetry"],
    });
    expect(mocks.checkKnownBlockedUrlRuleSupport.mock.calls[0]![1]).toBe(mocks.warn);
    expect(orderOf(mocks.checkKnownBlockedUrlRuleSupport)).toBeLessThan(orderOf(mocks.runDocker));
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
    mocks.readSetupInputs.mockReturnValue(
      inputsWith({
        proxyMode: "audit",
        failOnCaResidue: false,
        httpsRules: ["example.com:443", "*.npmjs.org:443"],
        httpRules: ["deb.debian.org:80"],
        ipRules: ["10.0.0.0/8"],
        urlRules: ["GET https://example.com/ok"],
        tlsRules: ["example.com"],
        knownBlockedRules: ["blocked.example:443"],
      }),
    );

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
        "-v",
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

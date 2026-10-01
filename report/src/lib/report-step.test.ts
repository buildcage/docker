import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { InvalidInputError } from "#core/lib/actions/inputs.ts";
import { REPORT_ACTION_SCRIPT_PATH } from "#report/report-source.ts";

import { ReportError } from "./errors.ts";
import { runReportStep, type ReportStepDeps } from "./report-step.ts";

// Every collaborator is tested in its own file; what is left to check here is
// the order they run in, what each one is handed, and which of them still run
// when an earlier step fails.
const mocks = {
  readBuilderName: vi.fn(),
  checkFailOnBlocked: vi.fn(),
  readTrafficArtifactInputs: vi.fn(),
  createDocker: vi.fn(),
  findReportSourceContainer: vi.fn(),
  copyFromContainerImage: vi.fn(),
  runReportScript: vi.fn(),
  uploadTrafficArtifact: vi.fn(),
  makeScratchDir: vi.fn(),
  removeScratchDir: vi.fn(),
  warn: vi.fn(),
};

// A bag of doubles, not a partially-typed stand-in: every step is replaced, so
// the cast says what the shape already is.
const deps = mocks as unknown as ReportStepDeps;

const SCRATCH = "/tmp/buildcage-report-abc123";
const CONTAINER = "container-abc123";
/** `buildcage-` + the first 12 hex of sha256("buildcage"): the same name
 *  setup derives from its own builder_name input. */
const PROJECT_NAME = "buildcage-eeb358f947ee";

let prevExitCode: number | string | null | undefined;
let prevHooks: string | undefined;

beforeEach(() => {
  prevExitCode = process.exitCode;
  process.exitCode = undefined;
  // The build-test-hooks flag is a build-time gate the source reads from
  // process.env; save and clear it so each test starts with the override off.
  prevHooks = process.env.BUILDCAGE_BUILD_TEST_HOOKS;
  delete process.env.BUILDCAGE_BUILD_TEST_HOOKS;
  vi.resetAllMocks();
  mocks.readBuilderName.mockReturnValue("buildcage");
  mocks.readTrafficArtifactInputs.mockReturnValue({ wanted: false });
  mocks.createDocker.mockReturnValue({ docker: true });
  mocks.findReportSourceContainer.mockReturnValue(CONTAINER);
  mocks.makeScratchDir.mockReturnValue(SCRATCH);
  mocks.runReportScript.mockReturnValue(0);
  mocks.uploadTrafficArtifact.mockResolvedValue(undefined);
});

afterEach(() => {
  process.exitCode = prevExitCode;
  if (prevHooks === undefined) delete process.env.BUILDCAGE_BUILD_TEST_HOOKS;
  else process.env.BUILDCAGE_BUILD_TEST_HOOKS = prevHooks;
});

describe("runReportStep", () => {
  it("finds the container by the project name derived from the builder name", async () => {
    await runReportStep({}, deps);
    expect(mocks.findReportSourceContainer).toHaveBeenCalledWith(
      { docker: true },
      PROJECT_NAME,
      "buildcage",
    );
  });

  it("copies the report script out of the container's image and runs it against that container", async () => {
    await runReportStep({}, deps);
    expect(mocks.copyFromContainerImage).toHaveBeenCalledWith(
      CONTAINER,
      REPORT_ACTION_SCRIPT_PATH,
      `${SCRATCH}/report-action.js`,
    );
    expect(mocks.runReportScript).toHaveBeenCalledWith(
      `${SCRATCH}/report-action.js`,
      CONTAINER,
      expect.anything(),
    );
  });

  it("reproduces the script's exit status as this step's own", async () => {
    mocks.runReportScript.mockReturnValue(1);
    await runReportStep({}, deps);
    expect(process.exitCode).toBe(1);
  });

  it("removes the scratch directory it made", async () => {
    await runReportStep({}, deps);
    expect(mocks.removeScratchDir).toHaveBeenCalledWith(SCRATCH);
  });
});

describe("input checks", () => {
  it("stops before touching Docker when an input is invalid", async () => {
    mocks.checkFailOnBlocked.mockImplementation(() => {
      throw new InvalidInputError("bad", "INVALID_BOOLEAN_INPUT");
    });
    await expect(runReportStep({}, deps)).rejects.toThrow(InvalidInputError);
    expect(mocks.createDocker).not.toHaveBeenCalled();
    expect(mocks.runReportScript).not.toHaveBeenCalled();
  });
});

describe("the COMPOSE_PROJECT_NAME override, which is this repo's own test hook", () => {
  it("is ignored without the build-test-hooks flag, however the environment is set", async () => {
    await runReportStep({ COMPOSE_PROJECT_NAME: "somebody-elses-project" }, deps);
    expect(mocks.findReportSourceContainer).toHaveBeenCalledWith(
      expect.anything(),
      PROJECT_NAME,
      "buildcage",
    );
  });

  it("takes the name as given once the flag is set", async () => {
    process.env.BUILDCAGE_BUILD_TEST_HOOKS = "1";
    await runReportStep({ COMPOSE_PROJECT_NAME: "buildcage-e2e" }, deps);
    expect(mocks.findReportSourceContainer).toHaveBeenCalledWith(
      expect.anything(),
      "buildcage-e2e",
      "buildcage",
    );
  });
});

describe("the traffic artifact", () => {
  it("names no traffic file, and uploads nothing, when none was asked for", async () => {
    await runReportStep({}, deps);
    expect(mocks.runReportScript.mock.calls[0][2].trafficFile).toBe(undefined);
    expect(mocks.uploadTrafficArtifact).not.toHaveBeenCalled();
  });

  it("names a file inside the scratch dir, so only what this step created is uploaded", async () => {
    mocks.readTrafficArtifactInputs.mockReturnValue({ wanted: true, retentionDays: 7 });
    await runReportStep({}, deps);
    expect(mocks.runReportScript.mock.calls[0][2].trafficFile).toBe(`${SCRATCH}/traffic.json`);
    expect(mocks.uploadTrafficArtifact).toHaveBeenCalledWith(
      `${SCRATCH}/traffic.json`,
      "buildcage",
      mocks.warn,
      { retentionDays: 7 },
    );
  });

  it("uploads before the scratch dir is removed, since the file lives inside it", async () => {
    mocks.readTrafficArtifactInputs.mockReturnValue({ wanted: true });
    const order: string[] = [];
    mocks.uploadTrafficArtifact.mockImplementation(async () => void order.push("upload"));
    mocks.removeScratchDir.mockImplementation(() => void order.push("remove"));
    await runReportStep({}, deps);
    expect(order).toStrictEqual(["upload", "remove"]);
  });

  it("still uploads when the report script throws, since the run that failed wants it most", async () => {
    mocks.readTrafficArtifactInputs.mockReturnValue({ wanted: true });
    mocks.runReportScript.mockImplementation(() => {
      throw new ReportError("node is not on PATH", "REPORT_SCRIPT_FAILED");
    });
    await expect(runReportStep({}, deps)).rejects.toThrow(ReportError);
    expect(mocks.uploadTrafficArtifact).toHaveBeenCalledWith(
      `${SCRATCH}/traffic.json`,
      "buildcage",
      mocks.warn,
      { retentionDays: undefined },
    );
    expect(mocks.removeScratchDir).toHaveBeenCalledWith(SCRATCH);
  });
});

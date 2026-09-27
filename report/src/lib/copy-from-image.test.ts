import { describe, it, expect } from "vitest";

import { copyFromContainerImage } from "./copy-from-image.ts";
import { ReportError } from "./errors.ts";
import { REPORT_ACTION_SCRIPT_PATH } from "#report/report-source.ts";

const BUILDER_ID = "builder123";
const IMAGE_ID = "sha256:feedface";
const SCRATCH_ID = "scratch456";
const HOST_PATH = "/tmp/report-action.js";

/** Records every invocation's argv and returns a scripted response per call. */
function fakeRun(responses: string[]): { run: (args: string[]) => string; calls: string[][] } {
  const calls: string[][] = [];
  let i = 0;
  return {
    calls,
    run(args: string[]) {
      calls.push(args);
      return responses[i++] ?? "";
    },
  };
}

/** A run where `failing` throws with stderr, and every other step succeeds. */
function failingAt(failing: string): (args: string[]) => string {
  return (args: string[]) => {
    if (args[0] === failing) {
      throw Object.assign(new Error("exit 1"), { status: 1, stderr: `${failing} said no` });
    }
    if (args[0] === "inspect") return IMAGE_ID;
    if (args[0] === "create") return SCRATCH_ID;
    return "";
  };
}

function caught(call: () => unknown): ReportError {
  try {
    call();
  } catch (e) {
    return e as ReportError;
  }
  throw new Error("expected copyFromContainerImage to throw");
}

describe("copyFromContainerImage", () => {
  it("copies from a scratch container made from the builder's image, then removes it", () => {
    const { run, calls } = fakeRun([`${IMAGE_ID}\n`, `${SCRATCH_ID}\n`, "", ""]);

    copyFromContainerImage(BUILDER_ID, REPORT_ACTION_SCRIPT_PATH, HOST_PATH, run);

    expect(calls).toStrictEqual([
      ["inspect", BUILDER_ID, "--format", "{{.Image}}"],
      ["create", IMAGE_ID],
      ["cp", `${SCRATCH_ID}:${REPORT_ACTION_SCRIPT_PATH}`, HOST_PATH],
      ["rm", "-f", SCRATCH_ID],
    ]);
  });

  it("never reads the running container itself", () => {
    const { run, calls } = fakeRun([IMAGE_ID, SCRATCH_ID, "", ""]);

    copyFromContainerImage(BUILDER_ID, REPORT_ACTION_SCRIPT_PATH, HOST_PATH, run);

    const cp = calls.find((args) => args[0] === "cp");
    expect(cp).toBeDefined();
    expect(cp!.some((arg) => arg.includes(BUILDER_ID))).toBe(false);
  });

  it("removes the scratch container even when the copy fails", () => {
    const calls: string[][] = [];
    const failing = failingAt("cp");
    const run = (args: string[]) => {
      calls.push(args);
      return failing(args);
    };

    expect(() =>
      copyFromContainerImage(BUILDER_ID, REPORT_ACTION_SCRIPT_PATH, HOST_PATH, run),
    ).toThrow(ReportError);
    expect(calls.at(-1)).toStrictEqual(["rm", "-f", SCRATCH_ID]);
  });

  it("keeps the copy's failure when the cleanup fails too", () => {
    const run = (args: string[]) => {
      if (args[0] === "inspect") return IMAGE_ID;
      if (args[0] === "create") return SCRATCH_ID;
      throw Object.assign(new Error("exit 1"), {
        stderr: args[0] === "cp" ? "no such file" : "rm failed",
      });
    };

    expect(
      caught(() => copyFromContainerImage(BUILDER_ID, REPORT_ACTION_SCRIPT_PATH, HOST_PATH, run))
        .message,
    ).toContain("no such file");
  });

  // Reporting a docker create failure as a docker cp failure sends the reader
  // looking at the wrong step.
  it.each([
    ["inspect", "docker inspect (resolving the builder's image)"],
    ["create", "docker create (making a scratch container from the builder's image)"],
    ["cp", `docker cp (fetching ${REPORT_ACTION_SCRIPT_PATH} from the builder image)`],
  ])("names %s as the operation that failed", (failing, operation) => {
    const error = caught(() =>
      copyFromContainerImage(BUILDER_ID, REPORT_ACTION_SCRIPT_PATH, HOST_PATH, failingAt(failing)),
    );

    expect(error).toBeInstanceOf(ReportError);
    expect(error.code).toBe("DOCKER_UNAVAILABLE");
    expect(error.message).toContain(`${operation} failed: ${failing} said no`);
  });

  it("throws when docker inspect reports no image", () => {
    const { run } = fakeRun(["\n"]);

    const error = caught(() =>
      copyFromContainerImage(BUILDER_ID, REPORT_ACTION_SCRIPT_PATH, HOST_PATH, run),
    );

    expect(error.code).toBe("DOCKER_UNAVAILABLE");
    expect(error.message).toBe(`docker inspect reported no image for container ${BUILDER_ID}`);
  });
});

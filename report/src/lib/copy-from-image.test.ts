import { describe, it, expect } from "vitest";

import { copyFromContainerImage } from "./copy-from-image.ts";
import { REPORT_ACTION_SCRIPT_PATH } from "#core/lib/docker/report-source.ts";

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
    const run = (args: string[]) => {
      calls.push(args);
      if (args[0] === "inspect") return IMAGE_ID;
      if (args[0] === "create") return SCRATCH_ID;
      if (args[0] === "cp") throw new Error("no such file");
      return "";
    };

    expect(() =>
      copyFromContainerImage(BUILDER_ID, REPORT_ACTION_SCRIPT_PATH, HOST_PATH, run),
    ).toThrow("no such file");
    expect(calls.at(-1)).toStrictEqual(["rm", "-f", SCRATCH_ID]);
  });

  it("keeps the copy's failure when the cleanup fails too", () => {
    const run = (args: string[]) => {
      if (args[0] === "inspect") return IMAGE_ID;
      if (args[0] === "create") return SCRATCH_ID;
      throw new Error(args[0] === "cp" ? "no such file" : "rm failed");
    };

    expect(() =>
      copyFromContainerImage(BUILDER_ID, REPORT_ACTION_SCRIPT_PATH, HOST_PATH, run),
    ).toThrow("no such file");
  });

  it("throws when docker inspect reports no image", () => {
    const { run } = fakeRun(["\n"]);

    expect(() =>
      copyFromContainerImage(BUILDER_ID, REPORT_ACTION_SCRIPT_PATH, HOST_PATH, run),
    ).toThrow(`docker inspect reported no image for container ${BUILDER_ID}`);
  });
});

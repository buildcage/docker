import * as core from "@actions/core";
import { describe, it, expect, vi } from "vitest";

import { writeStepSummary } from "./write-step-summary.ts";

describe("writeStepSummary", () => {
  it("writes through core.summary when there is a summary file", async () => {
    const addRaw = vi.spyOn(core.summary, "addRaw").mockReturnValue(core.summary);
    const write = vi.spyOn(core.summary, "write").mockResolvedValue(core.summary);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await writeStepSummary("# report", "/dev/null");

    expect(addRaw.mock.calls[0][0]).toBe("# report");
    expect(write.mock.calls.length).toBe(1);
    expect(log.mock.calls.length).toBe(0);
  });

  it("falls back to stdout when there is none", async () => {
    const write = vi.spyOn(core.summary, "write").mockResolvedValue(core.summary);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await writeStepSummary("# report", undefined);

    expect(write.mock.calls.length).toBe(0);
    expect(log.mock.calls).toStrictEqual([["# report"]]);
  });
});

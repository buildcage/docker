import { describe, it, expect, vi } from "vitest";

import { ActionError } from "#core/lib/errors.ts";

import { exitOnFatalError } from "./fatal.ts";

class TestError extends ActionError<"SOME_CODE"> {}

/** process.exit never returns, so the handler is driven through a stub that
 *  throws instead, or the test run itself would end here. */
function runHandler(context: string, err: unknown): { lines: string[]; exitCode: number } {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`exit:${code}`);
  });
  try {
    expect(() => exitOnFatalError(context)(err)).toThrow(/^exit:/);
    return {
      lines: log.mock.calls.map((c) => String(c[0])),
      exitCode: Number(exit.mock.calls[0][0]),
    };
  } finally {
    log.mockRestore();
    exit.mockRestore();
  }
}

describe("exitOnFatalError", () => {
  it("prints an ActionError's own message, unlabelled", () => {
    const { lines } = runHandler("setup", new TestError("builder_name is taken", "SOME_CODE"));
    expect(lines).toStrictEqual(["::error::builder_name is taken"]);
  });

  it("labels anything else as unexpected and names the step it escaped from", () => {
    const { lines } = runHandler("report", new Error("kaboom"));
    expect(lines).toStrictEqual(["::error::Unexpected error in report: kaboom"]);
  });

  it("handles a thrown non-Error", () => {
    const { lines } = runHandler("setup", "just a string");
    expect(lines).toStrictEqual(["::error::Unexpected error in setup: just a string"]);
  });

  it("exits non-zero, so the step fails rather than passing quietly", () => {
    expect(runHandler("setup", new Error("kaboom")).exitCode).toBe(1);
  });
});

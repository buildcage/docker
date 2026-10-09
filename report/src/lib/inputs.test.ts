import { describe, it, expect } from "vitest";

import { DEFAULT_BUILDER_NAME } from "#report/report-source.ts";

import { checkFailOnBlocked, readBuilderName } from "./inputs.ts";

/** Stands in for core.getInput, which returns "" for anything unset. */
function inputs(values: Record<string, string> = {}): (name: string) => string {
  return (name) => values[name] ?? "";
}

describe("readBuilderName", () => {
  it("returns the input when set", () => {
    expect(readBuilderName(inputs({ builder_name: "mine" }))).toBe("mine");
  });

  // Report finds setup's container by the project name this derives to, so the
  // fallback has to be the same one setup used.
  it("falls back to the shared default when unset", () => {
    expect(readBuilderName(inputs())).toBe(DEFAULT_BUILDER_NAME);
  });

  it("refuses a name that is not a valid container name", () => {
    expect(() => readBuilderName(inputs({ builder_name: "a;b" }))).toThrow(
      'Invalid builder_name: "a;b".',
    );
  });

  it("treats an empty input as unset rather than as a builder named ''", () => {
    expect(readBuilderName(inputs({ builder_name: "" }))).toBe(DEFAULT_BUILDER_NAME);
  });
});

describe("checkFailOnBlocked", () => {
  it.each(["", "false"])("accepts %o", (value) => {
    expect(() => checkFailOnBlocked(inputs({ fail_on_blocked: value }))).not.toThrow();
  });

  it("refuses a typo rather than guessing", () => {
    expect(() => checkFailOnBlocked(inputs({ fail_on_blocked: "yes" }))).toThrow(
      'Invalid fail_on_blocked: "yes". Must be true or false.',
    );
  });
});

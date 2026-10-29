import { describe, it, expect } from "vitest";

import { DEFAULT_BUILDER_NAME } from "#report/report-source.ts";

import { checkFailOnBlocked, readBuilderName } from "./inputs.ts";

/** Stands in for core.getInput, which returns "" for anything unset. */
function inputs(values: Record<string, string> = {}): (name: string) => string {
  return (name) => values[name] ?? "";
}

describe("readBuilderName", () => {
  // Report finds setup's container by the project name this derives to, so the
  // fallback has to be the same one setup used.
  it("reads builder-name, falling back to the shared default when unset", () => {
    expect(readBuilderName(inputs({ "builder-name": "mine" }))).toBe("mine");
    expect(readBuilderName(inputs())).toBe(DEFAULT_BUILDER_NAME);
  });
});

describe("checkFailOnBlocked", () => {
  it.each(["", "false"])("accepts %o", (value) => {
    expect(() => checkFailOnBlocked(inputs({ "fail-on-blocked": value }))).not.toThrow();
  });

  it("refuses a typo rather than guessing", () => {
    expect(() => checkFailOnBlocked(inputs({ "fail-on-blocked": "yes" }))).toThrow(
      'Invalid fail-on-blocked: "yes". Must be true or false.',
    );
  });
});

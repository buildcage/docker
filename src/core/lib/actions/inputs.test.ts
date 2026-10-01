import { describe, it, expect } from "vitest";

import { InvalidInputError, readBooleanInput, readRetentionDays } from "./inputs.ts";

/** Stands in for core.getInput, which returns "" for anything unset. */
function inputs(values: Record<string, string> = {}): (name: string) => string {
  return (name) => values[name] ?? "";
}

describe("readBooleanInput", () => {
  it.each(["true", "True", "TRUE"])("reads %o as true", (value) => {
    expect(readBooleanInput("flag", false, inputs({ flag: value }))).toBe(true);
  });

  it.each(["false", "False", "FALSE"])("reads %o as false", (value) => {
    expect(readBooleanInput("flag", true, inputs({ flag: value }))).toBe(false);
  });

  it.each([true, false])("takes the fallback %o when unset", (fallback) => {
    expect(readBooleanInput("flag", fallback, inputs())).toBe(fallback);
  });

  // A typo read as either value would silently change what the run enforces.
  it.each(["no", "0", "off", "yes", "1", "flase", " true"])(
    "refuses %o, naming the input",
    (value) => {
      expect(() => readBooleanInput("flag", true, inputs({ flag: value }))).toThrow(
        expect.objectContaining({
          name: InvalidInputError.name,
          code: "INVALID_BOOLEAN_INPUT",
          message: `Invalid flag: ${JSON.stringify(value)}. Must be true or false.`,
        }),
      );
    },
  );
});

describe("readRetentionDays", () => {
  it("is undefined when unset", () => {
    expect(readRetentionDays(inputs())).toBeUndefined();
  });

  it("reads a positive whole number of days", () => {
    expect(readRetentionDays(inputs({ traffic_artifact_retention_days: "7" }))).toBe(7);
  });

  it.each(["0", "-1", "7.5", "forever", "1e1", "0x10", "7d", " 7", "07"])("refuses %o", (value) => {
    expect(() => readRetentionDays(inputs({ traffic_artifact_retention_days: value }))).toThrow(
      expect.objectContaining({
        name: InvalidInputError.name,
        code: "INVALID_TRAFFIC_ARTIFACT_RETENTION_DAYS",
        message:
          `Invalid traffic_artifact_retention_days: ${JSON.stringify(value)}. ` +
          "Must be a whole number of days above zero.",
      }),
    );
  });
});

import { describe, it, expect } from "vitest";

import { DEFAULT_BUILDER_NAME } from "#report/report-source.ts";

import { ReportError } from "./errors.ts";
import { checkFailOnBlocked, readBuilderName, readTrafficArtifactInputs } from "./inputs.ts";

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

  it("treats an empty input as unset rather than as a builder named ''", () => {
    expect(readBuilderName(inputs({ builder_name: "" }))).toBe(DEFAULT_BUILDER_NAME);
  });
});

describe("checkFailOnBlocked", () => {
  it.each(["", "true", "True", "TRUE", "false", "False", "FALSE"])("accepts %o", (value) => {
    expect(() => checkFailOnBlocked(inputs({ fail_on_blocked: value }))).not.toThrow();
  });

  it("refuses a typo rather than guessing", () => {
    expect(() => checkFailOnBlocked(inputs({ fail_on_blocked: "yes" }))).toThrow(
      new ReportError(
        'Invalid fail_on_blocked: "yes". Must be true or false.',
        "INVALID_BOOLEAN_INPUT",
      ),
    );
  });
});

describe("readTrafficArtifactInputs", () => {
  it.each(["true", "True", "TRUE"])("reads %o as a yes", (value) => {
    expect(readTrafficArtifactInputs(inputs({ upload_traffic_artifact: value })).wanted).toBe(true);
  });

  it.each(["false", "False", "FALSE"])("reads %o as a no", (value) => {
    expect(readTrafficArtifactInputs(inputs({ upload_traffic_artifact: value })).wanted).toBe(
      false,
    );
  });

  // The dev and test invocations run this from source rather than through
  // action.yml's own defaults.
  it("is a no when unset", () => {
    expect(readTrafficArtifactInputs(inputs())).toStrictEqual({ wanted: false });
  });

  it("refuses a typo rather than reading it as a no", () => {
    expect(() => readTrafficArtifactInputs(inputs({ upload_traffic_artifact: "yes" }))).toThrow(
      new ReportError(
        'Invalid upload_traffic_artifact: "yes". Must be true or false.',
        "INVALID_BOOLEAN_INPUT",
      ),
    );
  });

  it("passes a positive whole number of retention days through", () => {
    expect(
      readTrafficArtifactInputs(inputs({ traffic_artifact_retention_days: "7" })).retentionDays,
    ).toBe(7);
  });

  it.each(["0", "-1", "7.5", "forever", "1e1", "0x10", " 7", "07"])(
    "refuses a retention of %o",
    (value) => {
      expect(() =>
        readTrafficArtifactInputs(inputs({ traffic_artifact_retention_days: value })),
      ).toThrow(
        new ReportError(
          `Invalid traffic_artifact_retention_days: ${JSON.stringify(value)}. ` +
            "Must be a whole number of days above zero.",
          "INVALID_TRAFFIC_ARTIFACT_RETENTION_DAYS",
        ),
      );
    },
  );

  it("refuses a bad retention even when nothing is uploaded", () => {
    expect(() =>
      readTrafficArtifactInputs(
        inputs({ upload_traffic_artifact: "false", traffic_artifact_retention_days: "0" }),
      ),
    ).toThrow(ReportError);
  });
});

import { describe, it, expect } from "vitest";

import { DEFAULT_BUILDER_NAME } from "#report/report-source.ts";

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
  it.each(["", "false"])("accepts %o", (value) => {
    expect(() => checkFailOnBlocked(inputs({ fail_on_blocked: value }))).not.toThrow();
  });

  it("refuses a typo rather than guessing", () => {
    expect(() => checkFailOnBlocked(inputs({ fail_on_blocked: "yes" }))).toThrow(
      'Invalid fail_on_blocked: "yes". Must be true or false.',
    );
  });
});

describe("readTrafficArtifactInputs", () => {
  // The dev and test invocations run this from source rather than through
  // action.yml's own defaults.
  it("uploads nothing and leaves the retention to the repository when unset", () => {
    expect(readTrafficArtifactInputs(inputs())).toStrictEqual({
      wanted: false,
      retentionDays: undefined,
    });
  });

  it("reads both inputs", () => {
    expect(
      readTrafficArtifactInputs(
        inputs({ upload_traffic_artifact: "true", traffic_artifact_retention_days: "7" }),
      ),
    ).toStrictEqual({ wanted: true, retentionDays: 7 });
  });

  it("refuses a typo rather than reading it as a no", () => {
    expect(() => readTrafficArtifactInputs(inputs({ upload_traffic_artifact: "yes" }))).toThrow(
      'Invalid upload_traffic_artifact: "yes". Must be true or false.',
    );
  });

  it("refuses a bad retention even when nothing is uploaded", () => {
    expect(() =>
      readTrafficArtifactInputs(
        inputs({ upload_traffic_artifact: "false", traffic_artifact_retention_days: "0" }),
      ),
    ).toThrow(/Invalid traffic_artifact_retention_days/);
  });
});

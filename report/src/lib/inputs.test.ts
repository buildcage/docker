import { describe, it, expect, vi } from "vitest";

import { readBuilderName, readTrafficArtifactInputs } from "./inputs.ts";
import { DEFAULT_BUILDER_NAME } from "#report/report-source.ts";

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

describe("readTrafficArtifactInputs", () => {
  const silent = () => {};

  it.each(["true", "True", "TRUE"])("reads %o as a yes", (value) => {
    expect(
      readTrafficArtifactInputs(silent, inputs({ upload_traffic_artifact: value })).wanted,
    ).toBe(true);
  });

  it.each(["false", "False", "FALSE"])("reads %o as a no", (value) => {
    const warn = vi.fn();

    expect(readTrafficArtifactInputs(warn, inputs({ upload_traffic_artifact: value })).wanted).toBe(
      false,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  // The dev and test invocations run this from source rather than through
  // action.yml's own defaults.
  it("is a silent no when unset", () => {
    const warn = vi.fn();

    expect(readTrafficArtifactInputs(warn, inputs()).wanted).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns rather than reading a typo as a no", () => {
    const warn = vi.fn();

    expect(readTrafficArtifactInputs(warn, inputs({ upload_traffic_artifact: "yes" })).wanted).toBe(
      false,
    );
    expect(warn).toHaveBeenCalledWith(
      'upload_traffic_artifact must be true or false, not "yes". Reading it as false.',
    );
  });

  it("passes a positive whole number of retention days through", () => {
    expect(
      readTrafficArtifactInputs(silent, inputs({ traffic_artifact_retention_days: "7" }))
        .retentionDays,
    ).toBe(7);
  });

  it("leaves the retention to the repository's own default when unset", () => {
    const warn = vi.fn();

    expect(readTrafficArtifactInputs(warn, inputs()).retentionDays).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(["0", "-1", "7.5", "forever"])("warns about %o rather than dropping it", (value) => {
    const warn = vi.fn();

    expect(
      readTrafficArtifactInputs(warn, inputs({ traffic_artifact_retention_days: value }))
        .retentionDays,
    ).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        `traffic_artifact_retention_days must be a whole number of days above zero, not ${JSON.stringify(value)}`,
      ),
    );
  });
});

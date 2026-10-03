import { describe, it, expect } from "vitest";

import {
  InvalidInputError,
  readBooleanInput,
  readRetentionDays,
  readTrafficArtifactInputs,
  resolveProxyEngine,
  resolveProxyMode,
} from "./inputs.ts";

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

describe("readTrafficArtifactInputs", () => {
  it("uploads nothing and leaves the retention to the repository when unset", () => {
    expect(readTrafficArtifactInputs(inputs())).toStrictEqual({
      upload: false,
      retentionDays: undefined,
    });
  });

  it("reads both inputs", () => {
    expect(
      readTrafficArtifactInputs(
        inputs({ upload_traffic_artifact: "true", traffic_artifact_retention_days: "7" }),
      ),
    ).toStrictEqual({ upload: true, retentionDays: 7 });
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

describe("resolveProxyEngine", () => {
  it("defaults to inspect for undefined or an empty string", () => {
    expect(resolveProxyEngine(undefined)).toBe("inspect");
    expect(resolveProxyEngine("")).toBe("inspect");
  });

  it("accepts each engine that has an image of its own", () => {
    expect(resolveProxyEngine("universal")).toBe("universal");
    expect(resolveProxyEngine("inspect")).toBe("inspect");
  });

  it("refuses a value that is not an engine, casing included", () => {
    for (const engine of ["restrict", "Inspect"]) {
      expect(() => resolveProxyEngine(engine)).toThrow(
        expect.objectContaining({ name: InvalidInputError.name, code: "INVALID_PROXY_ENGINE" }),
      );
    }
  });

  it("rejects the removed transparent alias, naming universal", () => {
    expect(() => resolveProxyEngine("transparent")).toThrowError(
      /transparent has been renamed.*proxy_engine: universal/,
    );
  });
});

describe("resolveProxyMode", () => {
  it("defaults to restrict when unset or blank", () => {
    expect(resolveProxyMode(undefined)).toBe("restrict");
    expect(resolveProxyMode("  ")).toBe("restrict");
  });

  it("accepts both modes", () => {
    expect(resolveProxyMode("audit")).toBe("audit");
    expect(resolveProxyMode("restrict")).toBe("restrict");
  });

  // Anything else would enforce a run meant only to record.
  it("rejects anything else, a differently cased mode included", () => {
    for (const mode of ["Audit", "RESTRICT", "enforce"]) {
      expect(() => resolveProxyMode(mode)).toThrow(
        expect.objectContaining({ name: InvalidInputError.name, code: "INVALID_PROXY_MODE" }),
      );
    }
  });
});

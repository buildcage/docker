import { describe, it, expect } from "vitest";

import { DEFAULT_BUILDER_NAME } from "#report/report-source.ts";

import { readBuilderName, readSetupInputs } from "./inputs.ts";

/** Stands in for core.getInput, which returns "" for anything unset. */
function inputs(values: Record<string, string> = {}): (name: string) => string {
  return (name) => values[name] ?? "";
}

describe("readBuilderName", () => {
  it("returns the input when set", () => {
    expect(readBuilderName(inputs({ builder_name: "mine" }))).toBe("mine");
  });

  it("falls back to the shared default when unset", () => {
    expect(readBuilderName(inputs())).toBe(DEFAULT_BUILDER_NAME);
  });

  // action.yml's own default supplies "buildcage" in a real run, so an empty
  // string only happens outside the Actions runtime, where the fallback has
  // to produce the same name the other two steps derive.
  it("treats an empty input as unset rather than as a builder named ''", () => {
    expect(readBuilderName(inputs({ builder_name: "" }))).toBe(DEFAULT_BUILDER_NAME);
  });
});

describe("readSetupInputs", () => {
  it("defaults proxy_engine to inspect", () => {
    expect(readSetupInputs(inputs()).proxyEngine).toBe("inspect");
  });

  it("keeps an explicit proxy_engine", () => {
    expect(readSetupInputs(inputs({ proxy_engine: "universal" })).proxyEngine).toBe("universal");
  });

  it("rejects an unknown engine before any other input", () => {
    expect(() => readSetupInputs(inputs({ proxy_engine: "nope", proxy_mode: "Audit" }))).toThrow(
      /Invalid proxy_engine/,
    );
  });

  it("rejects the removed explicit engine", () => {
    expect(() => readSetupInputs(inputs({ proxy_engine: "explicit" }))).toThrow(
      /explicit has been removed/,
    );
  });

  it("reads builder_name", () => {
    expect(readSetupInputs(inputs({ builder_name: "mine" })).builderName).toBe("mine");
  });

  it("rejects an unknown proxy_mode before fail_on_ca_residue and any rule", () => {
    expect(() =>
      readSetupInputs(
        inputs({ proxy_mode: "Audit", fail_on_ca_residue: "no", allowed_https_rules: "no-port" }),
      ),
    ).toThrow(/Invalid proxy_mode/);
  });

  it("reads fail_on_ca_residue", () => {
    expect(readSetupInputs(inputs({ fail_on_ca_residue: "false" })).failOnCaResidue).toBe(false);
  });

  // A typo read as false would let a copy of the CA into the image unannounced.
  it("rejects a fail_on_ca_residue that is not a boolean", () => {
    expect(() => readSetupInputs(inputs({ fail_on_ca_residue: "no" }))).toThrow(
      'Invalid fail_on_ca_residue: "no". Must be true or false.',
    );
  });

  it("reads proxy_mode and the rules", () => {
    const parsed = readSetupInputs(
      inputs({ proxy_mode: "audit", allowed_https_rules: "a.example.com:443" }),
    );
    expect(parsed.proxyMode).toBe("audit");
    expect(parsed.httpsRules).toStrictEqual(["a.example.com:443"]);
  });

  it("returns empty rule lists when nothing is set", () => {
    expect(readSetupInputs(inputs())).toStrictEqual({
      proxyEngine: "inspect",
      builderName: DEFAULT_BUILDER_NAME,
      proxyMode: "restrict",
      failOnCaResidue: true,
      httpsRules: [],
      httpRules: [],
      ipRules: [],
      urlRules: [],
      tlsRules: [],
      knownBlockedRules: [],
    });
  });
});

import { describe, it, expect } from "vitest";

import { DEFAULT_BUILDER_NAME } from "#report/report-source.ts";

import { readBuilderName, readSetupInputs } from "./inputs.ts";

/** Stands in for core.getInput, which returns "" for anything unset. */
function inputs(values: Record<string, string> = {}): (name: string) => string {
  return (name) => values[name] ?? "";
}

describe("readBuilderName", () => {
  it("reads builder-name, falling back to the shared default when unset", () => {
    expect(readBuilderName(inputs({ "builder-name": "mine" }))).toBe("mine");
    expect(readBuilderName(inputs())).toBe(DEFAULT_BUILDER_NAME);
  });
});

describe("readSetupInputs", () => {
  it("defaults proxy-engine to inspect", () => {
    expect(readSetupInputs(inputs()).proxyEngine).toBe("inspect");
  });

  it("keeps an explicit proxy-engine", () => {
    expect(readSetupInputs(inputs({ "proxy-engine": "universal" })).proxyEngine).toBe("universal");
  });

  it("rejects an unknown engine before any other input", () => {
    expect(() =>
      readSetupInputs(inputs({ "proxy-engine": "nope", "proxy-mode": "Audit" })),
    ).toThrow(/Invalid proxy-engine/);
  });

  it("reads builder-name", () => {
    expect(readSetupInputs(inputs({ "builder-name": "mine" })).builderName).toBe("mine");
  });

  it("rejects an unknown proxy-mode before fail-on-ca-residue and any rule", () => {
    expect(() =>
      readSetupInputs(
        inputs({
          "proxy-mode": "Audit",
          "fail-on-ca-residue": "no",
          "allowed-https-rules": "no-port",
        }),
      ),
    ).toThrow(/Invalid proxy-mode/);
  });

  it("reads fail-on-ca-residue", () => {
    expect(readSetupInputs(inputs({ "fail-on-ca-residue": "false" })).failOnCaResidue).toBe(false);
  });

  // A typo read as false would let a copy of the CA into the image unannounced.
  it("rejects a fail-on-ca-residue that is not a boolean", () => {
    expect(() => readSetupInputs(inputs({ "fail-on-ca-residue": "no" }))).toThrow(
      'Invalid fail-on-ca-residue: "no". Must be true or false.',
    );
  });

  it("reads proxy-mode and the rules", () => {
    const parsed = readSetupInputs(
      inputs({ "proxy-mode": "audit", "allowed-https-rules": "a.example.com:443" }),
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

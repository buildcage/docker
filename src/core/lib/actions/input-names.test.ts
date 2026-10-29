import * as core from "@actions/core";
import { afterEach, describe, expect, it } from "vitest";

import { inputEnvName, legacyInputName, normalizeInputNames } from "./input-names.ts";

describe("inputEnvName", () => {
  it("is the variable core.getInput reads", () => {
    process.env["INPUT_PROXY-MODE"] = "audit";
    try {
      expect(core.getInput("proxy-mode")).toBe(process.env[inputEnvName("proxy-mode")]);
    } finally {
      delete process.env["INPUT_PROXY-MODE"];
    }
  });
});

describe("legacyInputName", () => {
  it.each([
    ["proxy-mode", "proxy_mode"],
    ["traffic-artifact-retention-days", "traffic_artifact_retention_days"],
    ["run", "run"],
  ])("spells %o as %o", (name, legacy) => {
    expect(legacyInputName(name)).toBe(legacy);
  });
});

describe("normalizeInputNames", () => {
  const NAMES = ["proxy-mode", "allowed-https-rules", "run"];

  afterEach(() => {
    delete process.env.INPUT_PROXY_MODE;
  });

  it("moves an underscore spelling to the hyphenated name", () => {
    const env = { INPUT_PROXY_MODE: "audit", "INPUT_ALLOWED-HTTPS-RULES": "" };

    expect(normalizeInputNames(env, NAMES)).toEqual([]);
    expect(env).toEqual({ "INPUT_PROXY-MODE": "audit", "INPUT_ALLOWED-HTTPS-RULES": "" });
  });

  it("drops an empty underscore spelling, as the runner sets a declared default", () => {
    const env = { INPUT_PROXY_MODE: "", INPUT_ALLOWED_HTTPS_RULES: " " };

    expect(normalizeInputNames(env, NAMES)).toEqual([]);
    expect(env).toEqual({});
  });

  it("fills a hyphenated name set to empty", () => {
    const env = { INPUT_PROXY_MODE: "audit", "INPUT_PROXY-MODE": "" };

    normalizeInputNames(env, NAMES);

    expect(env).toEqual({ "INPUT_PROXY-MODE": "audit" });
  });

  it("keeps the hyphenated name over a different underscore one, and names what it ignored", () => {
    const env = {
      INPUT_PROXY_MODE: "audit",
      "INPUT_PROXY-MODE": "restrict",
      INPUT_ALLOWED_HTTPS_RULES: "a.example.com:443",
      "INPUT_ALLOWED-HTTPS-RULES": "b.example.com:443",
    };

    expect(normalizeInputNames(env, NAMES)).toEqual([
      "Ignored proxy_mode: proxy-mode is set.",
      "Ignored allowed_https_rules: allowed-https-rules is set.",
    ]);
    expect(env).toEqual({
      "INPUT_PROXY-MODE": "restrict",
      "INPUT_ALLOWED-HTTPS-RULES": "b.example.com:443",
    });
  });

  it("ignores an equal underscore spelling without a warning", () => {
    const env = { INPUT_PROXY_MODE: "audit ", "INPUT_PROXY-MODE": "audit" };

    expect(normalizeInputNames(env, NAMES)).toEqual([]);
    expect(env).toEqual({ "INPUT_PROXY-MODE": "audit" });
  });

  it("leaves a name with no underscore spelling", () => {
    const env = { INPUT_RUN: "make" };

    normalizeInputNames(env, NAMES);

    expect(env).toEqual({ INPUT_RUN: "make" });
  });

  it("leaves a name it was not given", () => {
    const env = { INPUT_PROXY_ENGINE: "inspect" };

    normalizeInputNames(env, NAMES);

    expect(env).toEqual({ INPUT_PROXY_ENGINE: "inspect" });
  });

  it("makes core.getInput read the underscore spelling's value", () => {
    process.env.INPUT_PROXY_MODE = "audit";

    normalizeInputNames(process.env, NAMES);

    expect(core.getInput("proxy-mode")).toBe("audit");
    delete process.env["INPUT_PROXY-MODE"];
  });
});

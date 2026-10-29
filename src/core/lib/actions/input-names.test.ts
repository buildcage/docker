import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as core from "@actions/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  inputEnvName,
  legacyInputName,
  normalizeInputNames,
  setOutputUnderBothNames,
} from "./input-names.ts";

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
  const LISTS = ["allowed-https-rules"];

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
    const env = { INPUT_PROXY_MODE: "audit", "INPUT_PROXY-MODE": "restrict" };

    expect(normalizeInputNames(env, NAMES, LISTS)).toEqual([
      "Ignored proxy_mode, as proxy-mode is also set.",
    ]);
    expect(env).toEqual({ "INPUT_PROXY-MODE": "restrict" });
  });

  it("joins a list input's two spellings, the hyphenated one's lines first", () => {
    const env = {
      INPUT_ALLOWED_HTTPS_RULES: "a.example.com:443",
      "INPUT_ALLOWED-HTTPS-RULES": "b.example.com:443\nc.example.com:443",
    };

    expect(normalizeInputNames(env, NAMES, LISTS)).toEqual([]);
    expect(env).toEqual({
      "INPUT_ALLOWED-HTTPS-RULES": "b.example.com:443\nc.example.com:443\na.example.com:443",
    });
  });

  it("keeps only the hyphenated value of an input it is not told is a list", () => {
    const env = {
      INPUT_ALLOWED_HTTPS_RULES: "a.example.com:443",
      "INPUT_ALLOWED-HTTPS-RULES": "b.example.com:443",
    };

    expect(normalizeInputNames(env, NAMES)).toEqual([
      "Ignored allowed_https_rules, as allowed-https-rules is also set.",
    ]);
    expect(env).toEqual({ "INPUT_ALLOWED-HTTPS-RULES": "b.example.com:443" });
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

describe("setOutputUnderBothNames", () => {
  it("sets the output under both spellings", () => {
    const setOutput = vi.fn();

    setOutputUnderBothNames("builder-name", "b", setOutput);

    expect(setOutput.mock.calls).toEqual([
      ["builder-name", "b"],
      ["builder_name", "b"],
    ]);
  });

  it("still sets the underscore spelling when the hyphenated one fails, then throws", () => {
    const failure = new Error("GITHUB_OUTPUT is gone");
    const setOutput = vi.fn((name: string) => {
      if (name === "builder-name") throw failure;
    });

    expect(() => setOutputUnderBothNames("builder-name", "b", setOutput)).toThrow(failure);
    expect(setOutput).toHaveBeenCalledWith("builder_name", "b");
  });

  it("writes to GITHUB_OUTPUT through core.setOutput by default", () => {
    const dir = mkdtempSync(join(tmpdir(), "buildcage-output-"));
    const file = join(dir, "output");
    writeFileSync(file, "");
    vi.stubEnv("GITHUB_OUTPUT", file);
    try {
      setOutputUnderBothNames("builder-name", "b");
      expect(readFileSync(file, "utf8")).toMatch(
        /^builder-name<<(\S+)\nb\n\1\nbuilder_name<<(\S+)\nb\n\2\n$/,
      );
    } finally {
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

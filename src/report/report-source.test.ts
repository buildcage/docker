import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { legacyInputName } from "#core/lib/actions/input-names.ts";
import { InvalidInputError } from "#core/lib/actions/inputs.ts";

import {
  CONFIG_FILE_INPUTS,
  DEFAULT_BUILDER_NAME,
  dropListInputs,
  INPUT_NAMES,
  resolveBuilderName,
} from "./report-source.ts";

function inputsOf(path: string): string[] {
  return Object.keys((parse(readFileSync(path, "utf8")) as { inputs: object }).inputs);
}

describe("CONFIG_FILE_INPUTS", () => {
  it("names every input of setup and report but config-file itself", () => {
    const inputs = new Set([...inputsOf("action.yml"), ...inputsOf("report/action.yml")]);
    inputs.delete("config-file");
    const hyphenated = [...inputs].filter((name) => !name.includes("_"));
    expect([...CONFIG_FILE_INPUTS.known].sort()).toEqual(hyphenated.sort());
  });

  it("declares each input's underscore spelling too, and INPUT_NAMES names them all", () => {
    for (const path of ["action.yml", "report/action.yml"]) {
      const declared = inputsOf(path);
      const hyphenated = declared.filter((name) => !name.includes("_"));
      expect(declared.filter((name) => name.includes("_")).sort()).toEqual(
        hyphenated.map(legacyInputName).sort(),
      );
      expect(INPUT_NAMES).toEqual(expect.arrayContaining(hyphenated));
    }
  });

  it("merges only inputs it knows", () => {
    expect(CONFIG_FILE_INPUTS.known).toEqual(expect.arrayContaining([...CONFIG_FILE_INPUTS.lists]));
  });
});

describe("resolveBuilderName", () => {
  it("takes the default when unset", () => {
    expect(resolveBuilderName("")).toBe(DEFAULT_BUILDER_NAME);
  });

  it.each(["ab", "my-builder_1.2", "0x"])("accepts %o", (name) => {
    expect(resolveBuilderName(name)).toBe(name);
  });

  it.each(["a", "-ab", ".ab", "a b", "a;b", "$(id)", "a\nb", "ab\n"])("refuses %o", (name) => {
    expect(() => resolveBuilderName(name)).toThrow(
      expect.objectContaining({ name: InvalidInputError.name, code: "INVALID_BUILDER_NAME" }),
    );
  });
});

describe("dropListInputs", () => {
  it("removes every list input and leaves the rest", () => {
    const env: NodeJS.ProcessEnv = { "INPUT_BUILDER-NAME": "b", INPUT_DIR: "d" };
    for (const name of CONFIG_FILE_INPUTS.lists) env[`INPUT_${name.toUpperCase()}`] = "x";
    dropListInputs(env);
    expect(env).toStrictEqual({ "INPUT_BUILDER-NAME": "b", INPUT_DIR: "d" });
  });
});

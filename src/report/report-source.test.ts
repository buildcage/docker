import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { InvalidInputError } from "#core/lib/actions/inputs.ts";

import { CONFIG_FILE_INPUTS, DEFAULT_BUILDER_NAME, resolveBuilderName } from "./report-source.ts";

function inputsOf(path: string): string[] {
  return Object.keys((parse(readFileSync(path, "utf8")) as { inputs: object }).inputs);
}

describe("CONFIG_FILE_INPUTS", () => {
  it("names every input of setup and report but config_file itself", () => {
    const inputs = new Set([...inputsOf("action.yml"), ...inputsOf("report/action.yml")]);
    inputs.delete("config_file");
    expect([...CONFIG_FILE_INPUTS.known].sort()).toEqual([...inputs].sort());
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

  // The setup action sets the name as an output, which a workflow may paste
  // into a run: script.
  it.each(["a", "-ab", ".ab", "a b", "a;b", "$(id)", "a\nb", "ab\n"])("refuses %o", (name) => {
    expect(() => resolveBuilderName(name)).toThrow(
      expect.objectContaining({ name: InvalidInputError.name, code: "INVALID_BUILDER_NAME" }),
    );
  });
});

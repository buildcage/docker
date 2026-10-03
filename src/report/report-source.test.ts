import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { CONFIG_FILE_INPUTS } from "./report-source.ts";

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

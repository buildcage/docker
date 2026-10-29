/**
 * Inputs are named with hyphens, and each still answers to the underscore
 * spelling it had first. Both are declared in action.yml, so neither draws the
 * runner's unexpected-input warning.
 */
import * as core from "@actions/core";

/** The variable `core.getInput(name)` reads. */
export function inputEnvName(name: string): string {
  return `INPUT_${name.replace(/ /g, "_").toUpperCase()}`;
}

/** The underscore spelling of a hyphenated input name. */
export function legacyInputName(name: string): string {
  return name.replaceAll("-", "_");
}

/**
 * Moves each input's underscore spelling into its hyphenated one in `env` and
 * removes it, so the rest of the step, and any process it starts, reads one
 * name. Where both are set the hyphenated one wins, but a list input takes
 * both, the hyphenated one's lines first, as config-file's lists do.
 *
 * @returns a warning for each underscore spelling ignored that way
 */
export function normalizeInputNames(
  env: NodeJS.ProcessEnv,
  names: readonly string[],
  lists: readonly string[] = [],
): string[] {
  const warnings: string[] = [];
  for (const name of names) {
    const legacy = legacyInputName(name);
    if (legacy === name) continue;
    const legacyEnvName = inputEnvName(legacy);
    const value = env[legacyEnvName] ?? "";
    delete env[legacyEnvName];
    if (!value.trim()) continue;
    const envName = inputEnvName(name);
    const current = env[envName] ?? "";
    if (!current.trim()) env[envName] = value;
    else if (lists.includes(name)) env[envName] = `${current}\n${value}`;
    // An equal value loses nothing.
    else if (current.trim() !== value.trim()) {
      warnings.push(`Ignored ${legacy}, as ${name} is also set.`);
    }
  }
  return warnings;
}

/**
 * Sets an output under `name` and its underscore spelling. Both are tried
 * before a failure is thrown, so neither keeps a value something else wrote to
 * it.
 */
export function setOutputUnderBothNames(
  name: string,
  value: string,
  setOutput: (name: string, value: string) => void = core.setOutput,
): void {
  const failures: unknown[] = [];
  for (const output of [name, legacyInputName(name)]) {
    try {
      setOutput(output, value);
    } catch (e) {
      failures.push(e);
    }
  }
  if (failures.length > 0) throw failures[0];
}

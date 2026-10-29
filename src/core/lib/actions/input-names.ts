/**
 * Inputs are named with hyphens, and each still answers to the underscore
 * spelling it had first. Both are declared in action.yml, so neither draws the
 * runner's unexpected-input warning.
 */

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
 * name. Where both are set the hyphenated one wins.
 *
 * @returns a warning for each underscore spelling ignored that way
 */
export function normalizeInputNames(env: NodeJS.ProcessEnv, names: readonly string[]): string[] {
  const warnings: string[] = [];
  for (const name of names) {
    const legacy = legacyInputName(name);
    if (legacy === name) continue;
    const legacyEnvName = inputEnvName(legacy);
    const value = env[legacyEnvName] ?? "";
    delete env[legacyEnvName];
    if (!value.trim()) continue;
    const current = env[inputEnvName(name)] ?? "";
    if (!current.trim()) env[inputEnvName(name)] = value;
    // An equal value loses nothing.
    else if (current.trim() !== value.trim()) warnings.push(`Ignored ${legacy}: ${name} is set.`);
  }
  return warnings;
}

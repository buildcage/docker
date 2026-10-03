/**
 * `config_file`: action inputs read from a YAML file in the repository.
 *
 * Each value is written into the `INPUT_*` variable `core.getInput` reads, so
 * every reader, a child process included, sees the merged value.
 */
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { parse } from "yaml";

import { ActionError, errorMessage } from "#core/lib/errors.ts";

export class ConfigFileError extends ActionError<
  "CONFIG_FILE_UNTRUSTED_EVENT" | "CONFIG_FILE_PATH" | "CONFIG_FILE_INVALID"
> {}

export interface ConfigFileInputs {
  /** Every input the file may set. */
  known: readonly string[];
  /** Inputs whose file value is appended to the workflow's rather than
   *  replaced by it. */
  lists: readonly string[];
}

export interface AppliedConfigFile {
  /** The file's real path. */
  path: string;
  /** Lines for the job log, one per input the file set. */
  summary: string[];
}

/** The variable `core.getInput(name)` reads. */
function inputEnvName(name: string): string {
  return `INPUT_${name.replace(/ /g, "_").toUpperCase()}`;
}

/**
 * On these events anyone can start a run of the default branch's workflow, so
 * its own inputs are out of a pull request's reach, but a checkout of the pull
 * request's head would put the file in it: a pull request could then allow
 * whatever it wanted. What the workspace holds can't be told from here, so
 * the event alone decides. A workflow_run triggered by another workflow_run
 * is refused too, as the payload doesn't say what started the chain.
 */
const UNTRUSTED_EVENTS = ["pull_request_target", "issue_comment"];

function refuseUntrustedEvent(env: NodeJS.ProcessEnv): void {
  const event = env.GITHUB_EVENT_NAME ?? "";
  let what = event;
  if (event === "workflow_run") {
    let runEvent: unknown;
    try {
      const payload = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH ?? "", "utf8")) as {
        workflow_run?: { event?: unknown };
      };
      runEvent = payload.workflow_run?.event;
    } catch (e) {
      throw new ConfigFileError(
        `config_file cannot be used: the workflow_run event payload could not be read (${errorMessage(e)}).`,
        "CONFIG_FILE_UNTRUSTED_EVENT",
      );
    }
    if (typeof runEvent !== "string") {
      what = "workflow_run with no triggering event";
    } else if (
      runEvent.startsWith("pull_request") ||
      runEvent === "workflow_run" ||
      UNTRUSTED_EVENTS.includes(runEvent)
    ) {
      what = `workflow_run triggered by ${runEvent}`;
    } else {
      return;
    }
  } else if (!UNTRUSTED_EVENTS.includes(event)) {
    return;
  }
  throw new ConfigFileError(
    `config_file cannot be used on ${what}: the workspace may hold a pull request's ` +
      `code, which could then rewrite its own rules. Set the inputs in the workflow instead.`,
    "CONFIG_FILE_UNTRUSTED_EVENT",
  );
}

function isOutside(root: string, path: string): boolean {
  const inside = relative(root, path);
  return inside === ".." || inside.startsWith(`..${sep}`);
}

/** The file's real path, refusing one outside the workspace. */
function resolveConfigPath(path: string, env: NodeJS.ProcessEnv): string {
  const pathError = (reason: string) =>
    new ConfigFileError(`config_file ${JSON.stringify(path)} ${reason}`, "CONFIG_FILE_PATH");

  if (isAbsolute(path)) throw pathError("must be relative to the workspace.");
  const workspace = resolve(env.GITHUB_WORKSPACE || process.cwd());
  const full = resolve(workspace, path);
  if (isOutside(workspace, full)) throw pathError("leads outside the workspace.");
  let real: string;
  try {
    real = realpathSync(full);
  } catch {
    throw pathError("was not found in the workspace. Check out the repository in an earlier step.");
  }
  if (isOutside(realpathSync(workspace), real)) throw pathError("leads outside the workspace.");
  return real;
}

/** Each key's value as the text an input would hold. */
function parseConfig(text: string, path: string, known: readonly string[]): Map<string, string> {
  const invalid = (reason: string) =>
    new ConfigFileError(
      `Invalid config_file ${JSON.stringify(path)}: ${reason}`,
      "CONFIG_FILE_INVALID",
    );

  let doc: unknown;
  try {
    doc = parse(text);
  } catch (e) {
    throw invalid(errorMessage(e));
  }
  if (doc == null) return new Map();
  if (typeof doc !== "object" || Array.isArray(doc)) {
    throw invalid("the top level must be a mapping of input names to values.");
  }

  const values = new Map<string, string>();
  for (const [key, value] of Object.entries(doc)) {
    if (!known.includes(key)) {
      throw invalid(`unknown key ${JSON.stringify(key)}. Allowed keys: ${known.join(", ")}.`);
    }
    if (value == null) {
      values.set(key, "");
    } else if (["string", "number", "boolean"].includes(typeof value)) {
      values.set(key, String(value));
    } else {
      throw invalid(`${key} must be a string, as it would be in the workflow.`);
    }
  }
  return values;
}

/**
 * Merges `config_file` into `env`'s `INPUT_*` variables. A value the workflow
 * set wins; a list input gets both, the workflow's first. Undefined when no
 * config_file was given.
 *
 * @throws {ConfigFileError} on an untrusted event, a path outside the
 *   workspace or missing, or a file that is not a flat mapping of known
 *   inputs
 */
export function applyConfigFile(
  env: NodeJS.ProcessEnv,
  { known, lists }: ConfigFileInputs,
): AppliedConfigFile | undefined {
  const path = env[inputEnvName("config_file")]?.trim() ?? "";
  if (!path) return undefined;

  refuseUntrustedEvent(env);
  const full = resolveConfigPath(path, env);
  let text: string;
  try {
    text = readFileSync(full, "utf8");
  } catch (e) {
    throw new ConfigFileError(
      `config_file ${JSON.stringify(path)} could not be read: ${errorMessage(e)}`,
      "CONFIG_FILE_PATH",
    );
  }
  const values = parseConfig(text, path, known);

  const summary = [`Inputs read from config_file ${path}:`];
  for (const [name, value] of values) {
    const envName = inputEnvName(name);
    const inline = env[envName] ?? "";
    if (lists.includes(name)) {
      env[envName] = [inline, value].filter((v) => v.trim()).join("\n");
      summary.push(`  ${name}${inline.trim() ? " (added to the workflow's)" : ""}`);
    } else if (inline.trim()) {
      summary.push(`  ${name} (ignored: the workflow sets it)`);
    } else {
      env[envName] = value;
      summary.push(`  ${name}`);
    }
  }
  return { path: full, summary };
}

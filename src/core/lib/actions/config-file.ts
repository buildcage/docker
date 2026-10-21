/**
 * `config_file`: action inputs read from a YAML file in the repository.
 *
 * Each value is written into the `INPUT_*` variable `core.getInput` reads, so
 * every reader, a child process included, sees the merged value.
 */
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { isScalar, LineCounter, parseDocument, Scalar, type Node, type YAMLMap } from "yaml";

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

/** Where the file's part of an input's value is. */
export interface ConfigValueOrigin {
  /** The line of the input's value it starts on, from 0: after the
   *  workflow's lines in a list input that has both. */
  offset: number;
  /** The file's line holding that first line, from 1. Only a `|` block keeps
   *  the lines after it on the file's next lines; YAML may fold or join any
   *  other value's. */
  line: number;
}

export interface AppliedConfigFile {
  /** The file's real path. */
  path: string;
  /** A warning naming the file's inputs the workflow overrode, if any. */
  warning?: string;
  /** Each input whose value now holds the file's, by name. */
  origins: Map<string, ConfigValueOrigin>;
}

/** The variable `core.getInput(name)` reads. */
function inputEnvName(name: string): string {
  return `INPUT_${name.replace(/ /g, "_").toUpperCase()}`;
}

/**
 * On these events the workflow comes from the default branch, so its own
 * inputs are out of a pull request's reach, but a checkout of the pull
 * request's head would put the file in it: a pull request could then allow
 * whatever it wanted. What the workspace holds can't be told from here, so
 * the event alone decides. The workflow_run test follows actions/checkout's
 * own refusal to check out a pull request there.
 */
function refuseUntrustedEvent(env: NodeJS.ProcessEnv): void {
  const event = env.GITHUB_EVENT_NAME;
  let triggeredBy: string | undefined;
  if (event === "workflow_run") {
    try {
      const payload = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH ?? "", "utf8")) as {
        workflow_run?: { event?: unknown };
      };
      const runEvent = payload.workflow_run?.event;
      triggeredBy = typeof runEvent === "string" ? runEvent : undefined;
    } catch (e) {
      throw new ConfigFileError(
        `config_file cannot be used: the workflow_run event payload could not be read (${errorMessage(e)}).`,
        "CONFIG_FILE_UNTRUSTED_EVENT",
      );
    }
    if (!triggeredBy?.startsWith("pull_request")) return;
  } else if (event !== "pull_request_target") {
    return;
  }
  const what = triggeredBy ? `workflow_run triggered by ${triggeredBy}` : event;
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

/** Each key's value as the text an input would hold, and the line its first line is on. */
function parseConfig(
  text: string,
  path: string,
  known: readonly string[],
): Map<string, { text: string; line: number }> {
  const invalid = (reason: string) =>
    new ConfigFileError(
      `Invalid config_file ${JSON.stringify(path)}: ${reason}`,
      "CONFIG_FILE_INVALID",
    );

  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter });
  if (doc.errors.length > 0) throw invalid(doc.errors[0].message);
  const js: unknown = doc.toJS();
  if (js == null) return new Map();
  if (typeof js !== "object" || Array.isArray(js)) {
    throw invalid("the top level must be a mapping of input names to values.");
  }

  // The line a value starts on; a `|` block's first line is the one after it.
  const lineOf = (key: string): number => {
    const node = (doc.contents as YAMLMap).get(key, true) as Node;
    const at = lineCounter.linePos(node.range![0]).line;
    return isScalar(node) && node.type === Scalar.BLOCK_LITERAL ? at + 1 : at;
  };
  const values = new Map<string, { text: string; line: number }>();
  for (const [key, value] of Object.entries(js)) {
    if (!known.includes(key)) {
      throw invalid(`unknown key ${JSON.stringify(key)}. Allowed keys: ${known.join(", ")}.`);
    }
    if (value == null) {
      values.set(key, { text: "", line: 0 });
    } else if (["string", "number", "boolean"].includes(typeof value)) {
      values.set(key, { text: String(value), line: lineOf(key) });
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

  const ignored: string[] = [];
  const origins = new Map<string, ConfigValueOrigin>();
  for (const [name, { text: value, line }] of values) {
    const envName = inputEnvName(name);
    const inline = env[envName] ?? "";
    if (lists.includes(name)) {
      env[envName] = [inline, value].filter((v) => v.trim()).join("\n");
      const offset = inline.trim() ? inline.split("\n").length : 0;
      if (value.trim()) origins.set(name, { offset, line });
    }
    // An empty or matching value loses nothing.
    else if (inline.trim()) {
      if (value.trim() && value.trim() !== inline.trim()) ignored.push(name);
    } else {
      env[envName] = value;
      if (value.trim()) origins.set(name, { offset: 0, line });
    }
  }
  if (!ignored.length) return { path: full, origins };
  return {
    path: full,
    warning: `Ignored from config_file ${path}, set by the workflow: ${ignored.join(", ")}`,
    origins,
  };
}

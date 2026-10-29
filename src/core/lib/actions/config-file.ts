/**
 * `config-file`: action inputs read from a YAML file in the repository.
 *
 * Each value is written into the `INPUT_*` variable `core.getInput` reads, so
 * every reader, a child process included, sees the merged value.
 */
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import {
  isAlias,
  isScalar,
  isSeq,
  LineCounter,
  parseDocument,
  Scalar,
  type Document,
  type YAMLMap,
} from "yaml";

import { ActionError, errorMessage } from "#core/lib/errors.ts";

import { inputEnvName, legacyInputName } from "./input-names.ts";

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
  /** The index, from 0, of the line it starts on in the input's `INPUT_*`
   *  variable, untrimmed: after the workflow's lines in a list input that
   *  has both. */
  offset: number;
  /** The file's line holding that first line, from 1, each later line of the
   *  value being on the file's next line. Absent when they are not, as YAML
   *  may fold or join a value's lines outside a `|` block. */
  line?: number;
}

export interface AppliedConfigFile {
  /** The file's real path. */
  path: string;
  /** A warning naming the file's inputs the workflow overrode, if any. */
  warning?: string;
  /** Each input the file's value was written into, by name. */
  origins: Map<string, ConfigValueOrigin>;
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
        `config-file cannot be used: the workflow_run event payload could not be read (${errorMessage(e)}).`,
        "CONFIG_FILE_UNTRUSTED_EVENT",
      );
    }
    if (!triggeredBy?.startsWith("pull_request")) return;
  } else if (event !== "pull_request_target") {
    return;
  }
  const what = triggeredBy ? `workflow_run triggered by ${triggeredBy}` : event;
  throw new ConfigFileError(
    `config-file cannot be used on ${what}: the workspace may hold a pull request's ` +
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
    new ConfigFileError(`config-file ${JSON.stringify(path)} ${reason}`, "CONFIG_FILE_PATH");

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

/** A key's value as the text an input would hold, and its line as ConfigValueOrigin has it. */
interface ParsedValue {
  text: string;
  line?: number;
}

const resolved = (node: unknown, doc: Document): unknown =>
  isAlias(node) ? node.resolve(doc) : node;

const MERGE_TAG = "tag:yaml.org,2002:merge";

/** Whether toJS() merges `key`'s value into its map, as yaml decides it. */
function isMergeKey(key: unknown, doc: Document): boolean {
  if (!isScalar(key) || (key.type && key.type !== Scalar.PLAIN)) return false;
  const { value } = key;
  const merge = value === "<<" || (typeof value === "symbol" && value.description === "<<");
  return merge && doc.schema.tags.some((tag) => tag.tag === MERGE_TAG && tag.default);
}

/**
 * Each key's value node in the document's top map, by the key's text. A key
 * the map does not set comes from its merge key's maps, the first one that
 * sets it winning, as toJS() merges them.
 */
function valueNodes(doc: Document): Map<string, unknown> {
  // A map merged many times is read once.
  const read = new Map<YAMLMap, Map<string, unknown>>();
  const nodesOf = (map: YAMLMap): Map<string, unknown> => {
    const done = read.get(map);
    if (done) return done;
    const nodes = new Map<string, unknown>();
    const merged: unknown[] = [];
    for (const { key, value } of map.items) {
      if (isMergeKey(key, doc)) {
        const source = resolved(value, doc);
        merged.push(...(isSeq(source) ? source.items : [source]));
      } else {
        const name = resolved(key, doc);
        // Only a scalar key can be a known input's.
        if (isScalar(name)) nodes.set(String(name.value), value);
      }
    }
    // toJS() refuses a merge of anything but maps.
    for (const source of merged.map((node) => resolved(node, doc)) as YAMLMap[])
      for (const [key, value] of nodesOf(source)) if (!nodes.has(key)) nodes.set(key, value);
    read.set(map, nodes);
    return nodes;
  };
  return nodesOf(doc.contents as YAMLMap);
}

/** Each key's value, as ParsedValue has it. */
function parseConfig(
  text: string,
  path: string,
  known: readonly string[],
): Map<string, ParsedValue> {
  const invalid = (reason: string) =>
    new ConfigFileError(
      `Invalid config-file ${JSON.stringify(path)}: ${reason}`,
      "CONFIG_FILE_INVALID",
    );

  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter });
  // As yaml's parse() reports them.
  for (const warning of doc.warnings) process.emitWarning(warning);
  if (doc.errors.length > 0) throw invalid(doc.errors[0].message);
  let js: unknown;
  try {
    js = doc.toJS();
  } catch (e) {
    throw invalid(errorMessage(e));
  }
  if (js == null) return new Map();
  if (typeof js !== "object" || Array.isArray(js)) {
    throw invalid("the top level must be a mapping of input names to values.");
  }

  const nodes = valueNodes(doc);
  const lineOf = (key: string, value: string): number | undefined => {
    // toJS() gave the key a string, number or boolean, so its node is a scalar.
    const node = resolved(nodes.get(key), doc) as Scalar;
    const [start, end] = node.range!;
    const at = lineCounter.linePos(start).line;
    // A block's first line is the one after its header. Only a literal one
    // keeps each line of its text on a line of its own.
    if (node.type === Scalar.BLOCK_LITERAL) return at + 1;
    if (node.type === Scalar.BLOCK_FOLDED) return undefined;
    // Any other value's text is on its line only when it is all on that one.
    return value.includes("\n") || lineCounter.linePos(end).line !== at ? undefined : at;
  };
  // The top map's own keys, which win over a merge key's as toJS() has it.
  const own = new Set(
    (doc.contents as YAMLMap).items
      .filter(({ key }) => !isMergeKey(key, doc))
      .map(({ key }) => resolved(key, doc))
      .filter(isScalar)
      .map((key) => String(key.value)),
  );
  // Each input's key; one in its underscore spelling is read as that input.
  const keys = new Map<string, string>();
  for (const key of Object.keys(js)) {
    const name = known.find((input) => key === input || key === legacyInputName(input));
    if (!name) {
      throw invalid(`unknown key ${JSON.stringify(key)}. Allowed keys: ${known.join(", ")}.`);
    }
    const other = keys.get(name);
    if (other === undefined || (own.has(key) && !own.has(other))) keys.set(name, key);
    else if (own.has(key) || !own.has(other)) {
      throw invalid(`${name} is set twice, also as ${legacyInputName(name)}.`);
    }
  }
  const values = new Map<string, ParsedValue>();
  for (const [name, key] of keys) {
    const value = (js as Record<string, unknown>)[key];
    if (value == null) {
      values.set(name, { text: "" });
    } else if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      const text = String(value);
      values.set(name, { text, line: lineOf(key, text) });
    } else {
      throw invalid(`${key} must be a string, as it would be in the workflow.`);
    }
  }
  return values;
}

/**
 * Merges `config-file` into `env`'s `INPUT_*` variables. A value the workflow
 * set wins; a list input gets both, the workflow's first. Undefined when no
 * config-file was given.
 *
 * @throws {ConfigFileError} on an untrusted event, a path outside the
 *   workspace or missing, or a file that is not a flat mapping of known
 *   inputs
 */
export function applyConfigFile(
  env: NodeJS.ProcessEnv,
  { known, lists }: ConfigFileInputs,
): AppliedConfigFile | undefined {
  const path = env[inputEnvName("config-file")]?.trim() ?? "";
  if (!path) return undefined;

  refuseUntrustedEvent(env);
  const full = resolveConfigPath(path, env);
  let text: string;
  try {
    text = readFileSync(full, "utf8");
  } catch (e) {
    throw new ConfigFileError(
      `config-file ${JSON.stringify(path)} could not be read: ${errorMessage(e)}`,
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
      const joined = [inline, value].filter((v) => v.trim()).join("\n");
      env[envName] = joined;
      // The file's value ends the joined text when it is there at all.
      const before = joined.slice(0, joined.length - value.length);
      if (value.trim()) origins.set(name, { offset: before.split("\n").length - 1, line });
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
    warning: `Ignored from config-file ${path}, set by the workflow: ${ignored.join(", ")}`,
    origins,
  };
}

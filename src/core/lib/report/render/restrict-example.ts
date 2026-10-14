/**
 * The parts every "Switch to restrict mode" snippet shares, whichever engine
 * built it: the `uses:` line and the <details> block the YAML sits in.
 */

/**
 * Where the conventional layout (jobs: -> <id>: -> steps: -> "- name:") puts a
 * step, so the snippet pastes into an existing steps: list as is.
 */
const STEP_INDENT = "      ";

/** The `uses:` line, with the resolved version as a trailing comment when known. */
export function usesLine(actionRepo: string, actionRef?: string, actionVersion?: string): string {
  return `  uses: ${actionRepo}@${actionRef}${actionVersion ? ` # ${actionVersion}` : ""}\n`;
}

/** What each action fills into its snippet's step. */
export interface ExampleStepOptions {
  /** The step's `name:`. Defaults to "Start Buildcage". */
  stepName?: string;
  /** Version to annotate the `uses:` line with, if known, as `# 3.1.4`. */
  actionVersion?: string;
  /** The `run:` input, for an action whose step runs the command itself: the
   *  snippet must then repeat it to stay copy-pasteable on its own. */
  runCommand?: string;
  /** Inputs the action adds after the rules, each a whole `name: value` line:
   *  a setting the rules cannot express, which pasting the snippet must not
   *  drop. */
  extraInputs?: string[];
}

/** The step's `name:`, `uses:` and `with:` lines. */
export function exampleStepHead(
  actionRepo: string,
  actionRef: string | undefined,
  { stepName = "Start Buildcage", actionVersion }: ExampleStepOptions = {},
): string {
  let yaml = `- name: ${stepName}\n`;
  yaml += usesLine(actionRepo, actionRef, actionVersion);
  yaml += "  with:\n";
  return yaml;
}

/** The `extraInputs` lines, then `run:` when given, at the snippet's input
 *  indentation. The command goes last so the inputs stay readable above a
 *  long script. */
export function exampleStepTail({ extraInputs = [], runCommand }: ExampleStepOptions): string {
  let yaml = extraInputs.map((line) => `    ${line}\n`).join("");
  if (runCommand) {
    // `|` keeps one trailing newline already (YAML's "clip" chomping), so a
    // second would split into a blank last line.
    const lines = runCommand.replace(/\r?\n$/, "").split(/\r?\n/);
    // `|` auto-detects the block's indentation from its first non-empty line, so
    // a command whose first such line is indented would set the base there and
    // leave the rest under it unparseable. `|2` pins the base two spaces in,
    // where every content line sits, so that leading indentation stays command
    // text. A leading tab needs no indicator: YAML reads it as content, not
    // indentation.
    const indicator = lines.find((line) => line !== "")?.startsWith(" ") ? "|2" : "|";
    yaml += `    run: ${indicator}\n`;
    for (const line of lines) {
      yaml += `      ${line}\n`;
    }
  }
  return yaml;
}

export interface RestrictExampleBlockOptions {
  /** Markdown rendered right under the snippet, ahead of the footnote. */
  appendix?: string;
  /** Rendered under the snippet as small print, when the engine has a caveat
   *  worth attaching to it. */
  footnote?: string;
}

export function restrictExampleBlock(
  yaml: string,
  { appendix, footnote }: RestrictExampleBlockOptions = {},
): string {
  const indented = yaml
    .split("\n")
    .map((line) => (line ? STEP_INDENT + line : line))
    .join("\n");

  let md = "\n<details>\n";
  md += "<summary>🛡️ Switch to restrict mode</summary>\n\n";
  md += "```yaml\n";
  md += indented;
  md += "```\n\n";
  if (appendix) md += appendix;
  if (footnote) md += `<sub>*${footnote}*</sub>\n\n`;
  md += "</details>\n";
  return md;
}

/** What a traffic report says in place of an example too large to print. */
export function restrictExampleTruncationNote(artifactAvailable: boolean): string {
  const rest = artifactAvailable
    ? "the buildcage-traffic artifact uploaded for this run has every request to write the rules from"
    : "set upload_traffic_artifact: true to get every request to write the rules from as a downloadable artifact";
  return `_…omitted: the example restrict step is too large for GitHub's Job Summary size limit; ${rest}._\n\n`;
}

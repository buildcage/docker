/**
 * The parts every "Switch to restrict mode" snippet shares, whichever engine
 * built it: the `uses:` line and the <details> block the YAML sits in.
 *
 * Shared rather than written out per renderer, so STEP_INDENT's own comment
 * cannot be fixed in one copy and missed in the other.
 */

/**
 * GitHub Actions' own indentation convention (jobs: -> <id>: -> steps: ->
 * "- name:") always puts a step 6 spaces in, so the generated snippet can be
 * pasted directly into an existing steps: list without re-indenting it.
 */
const STEP_INDENT = "      ";

/** The `uses:` line, with the resolved version as a trailing comment when known. */
export function usesLine(actionRepo: string, actionRef?: string, actionVersion?: string): string {
  return `  uses: ${actionRepo}@${actionRef}${actionVersion ? ` # ${actionVersion}` : ""}\n`;
}

/** What each action fills into the head of its snippet's step. */
export interface ExampleStepOptions {
  /** The step's `name:`. Defaults to "Start Buildcage". */
  stepName?: string;
  /** Version to annotate the `uses:` line with, if known, as `# 3.1.4`. */
  actionVersion?: string;
  /** The `run:` input, for an action whose step runs the command itself: the
   *  snippet must then repeat it to stay copy-pasteable on its own. */
  runCommand?: string;
}

/** The step's `name:`, `uses:` and `with:` lines, then `run:` when given. */
export function exampleStepHead(
  actionRepo: string,
  actionRef: string | undefined,
  { stepName = "Start Buildcage", actionVersion, runCommand }: ExampleStepOptions = {},
): string {
  let yaml = `- name: ${stepName}\n`;
  yaml += usesLine(actionRepo, actionRef, actionVersion);
  yaml += "  with:\n";
  if (runCommand) {
    yaml += "    run: |\n";
    // GitHub Actions' `run: |` block scalar always keeps one trailing
    // newline (YAML's default "clip" chomping), which would otherwise
    // split into a spurious blank line at the end.
    for (const line of runCommand.replace(/\r?\n$/, "").split(/\r?\n/)) {
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

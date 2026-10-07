import * as core from "@actions/core";

/**
 * core.summary.write() throws if GITHUB_STEP_SUMMARY is unset, so a caller
 * that has no summary path falls back to stdout: that is the local or manual
 * invocation, where the report would otherwise go nowhere.
 *
 * `markdown` is written as it stands. A report too large for GitHub's own
 * per-step limit is cut by its caller, which is the one that knows what may
 * be cut; see report/render/fit-step-summary.ts.
 */
export async function writeStepSummary(
  markdown: string,
  summaryFile: string | undefined,
): Promise<void> {
  if (summaryFile) {
    await core.summary.addRaw(markdown).write();
  } else {
    console.log(markdown);
  }
}

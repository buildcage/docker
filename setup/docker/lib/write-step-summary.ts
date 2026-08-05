import * as core from "@actions/core";

/**
 * core.summary.write() throws if GITHUB_STEP_SUMMARY is unset, so this
 * checks first and falls back to stdout for local/manual invocations.
 */
export async function writeStepSummary(markdown: string): Promise<void> {
  if (process.env.GITHUB_STEP_SUMMARY) {
    await core.summary.addRaw(markdown).write();
  } else {
    console.log(markdown);
  }
}

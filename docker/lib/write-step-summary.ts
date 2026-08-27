import * as core from "@actions/core";
import { truncateForStepSummary } from "#core/lib/report/render/truncate-communication-details.ts";

/**
 * core.summary.write() throws if GITHUB_STEP_SUMMARY is unset, so this
 * checks first and falls back to stdout for local/manual invocations.
 *
 * `artifactAvailable` only affects the wording of a truncation notice if the
 * report turns out to be too large for GitHub's own per-step limit — it does
 * not gate whether truncation happens. Callers with no artifact story
 * (universal, explicit) can omit it.
 */
export async function writeStepSummary(markdown: string, artifactAvailable = false): Promise<void> {
  if (process.env.GITHUB_STEP_SUMMARY) {
    await core.summary.addRaw(truncateForStepSummary(markdown, artifactAvailable)).write();
  } else {
    console.log(markdown);
  }
}

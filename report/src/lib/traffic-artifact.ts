import { existsSync } from "node:fs";
import { dirname } from "node:path";

import { errorMessage } from "#core/lib/errors.ts";
import { DEFAULT_BUILDER_NAME } from "#report/report-source.ts";
import type { Warn } from "./inputs.ts";

/** Fixed so a workflow can name it, suffixed per builder against collisions. */
export function artifactName(builderName: string): string {
  return builderName === DEFAULT_BUILDER_NAME
    ? "buildcage-traffic"
    : `buildcage-traffic-${builderName}`;
}

export type UploadArtifact = (
  name: string,
  files: string[],
  rootDirectory: string,
  options: { retentionDays?: number },
) => Promise<unknown>;

/**
 * Imported lazily so a run that asks for no artifact does not load it.
 *
 * Untested by design: the default behind the seam above, which only hands
 * @actions/artifact what the tested caller decided.
 */
/* v8 ignore start */
const uploadViaActionsArtifact: UploadArtifact = async (name, files, rootDirectory, options) => {
  const { DefaultArtifactClient } = await import("@actions/artifact");
  return new DefaultArtifactClient().uploadArtifact(name, files, rootDirectory, options);
};
/* v8 ignore stop */

export interface UploadTrafficArtifactOptions {
  /** Undefined leaves the retention to the repository's own default. */
  retentionDays?: number;
  /** `fileExists`/`upload` are injectable so tests can assert on the arguments
   *  instead of mocking node:fs and @actions/artifact directly. */
  fileExists?: (file: string) => boolean;
  upload?: UploadArtifact;
}

/**
 * Upload the traffic JSON the report script wrote. Best-effort: the exit
 * decision is already made, so a failed upload only warns.
 */
export async function uploadTrafficArtifact(
  file: string,
  builderName: string,
  warn: Warn,
  {
    retentionDays,
    fileExists = existsSync,
    upload = uploadViaActionsArtifact,
  }: UploadTrafficArtifactOptions = {},
): Promise<void> {
  // Both engines write the file whenever a traffic artifact is asked for, so a
  // missing file means the report script died before writing one: nothing to
  // upload, and its absence says nothing worth a warning.
  if (!fileExists(file)) return;
  const name = artifactName(builderName);
  try {
    await upload(name, [file], dirname(file), { retentionDays });
    console.log(`Uploaded the traffic JSON as ${name}`);
  } catch (e) {
    warn(`Could not upload the traffic artifact: ${errorMessage(e)}`);
  }
}

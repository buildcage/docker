import { buildComposeDownArgs } from "#core/lib/docker/args.ts";
import { resolveProjectName } from "#core/lib/docker/compose-project-name.ts";

import { readBuilderName, type GetInput } from "./inputs.ts";

/** The GITHUB_STATE key setup saves the builder name under. */
export const BUILDER_NAME_STATE = "builder_name";

export interface PostCleanupPlan {
  args: string[];
  env: NodeJS.ProcessEnv;
}

export interface PostCleanupSources {
  /** The builder name setup saved to GITHUB_STATE, empty when it saved none. */
  savedBuilderName?: string;
  /** Omitted, readBuilderName reads the real input. */
  getInput?: GetInput;
}

/**
 * The `docker compose down` the post step runs, for the builder setup named.
 *
 * The name comes from GITHUB_STATE first: setup may have read it from
 * config_file, which a later step can change or remove before the job ends.
 * A build cannot write GITHUB_STATE, so the saved name is the one setup used.
 * The input is the fallback for a setup that saved nothing.
 *
 * `projectNameOverride` is gated to this repo's own CI/dev testing by the
 * caller, which is where that gate stays visible.
 */
export function planPostCleanup(
  composeFile: string,
  projectNameOverride: string | undefined,
  env: NodeJS.ProcessEnv,
  { savedBuilderName, getInput }: PostCleanupSources = {},
): PostCleanupPlan {
  const builderName = savedBuilderName || readBuilderName(getInput);
  const projectName = resolveProjectName(builderName, projectNameOverride);
  return {
    args: buildComposeDownArgs({ composeFile, projectName }),
    env: { ...env, BUILDER_NAME: builderName },
  };
}

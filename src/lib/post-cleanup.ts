import { buildComposeDownArgs } from "#core/lib/docker/args.ts";
import { resolveProjectName } from "#core/lib/docker/compose-project-name.ts";

import { readBuilderName, type GetInput } from "./inputs.ts";

export interface PostCleanupPlan {
  args: string[];
  env: NodeJS.ProcessEnv;
}

/**
 * The `docker compose down` the post step runs. builder_name is a real input,
 * so the project name main.ts used is recomputed here directly, without
 * round-tripping it through GITHUB_STATE.
 *
 * `projectNameOverride` is gated to this repo's own CI/dev testing by the
 * caller, which is where that gate stays visible. Omitting `getInput` leaves
 * readBuilderName to read the real one.
 */
export function planPostCleanup(
  composeFile: string,
  projectNameOverride: string | undefined,
  env: NodeJS.ProcessEnv,
  getInput?: GetInput,
): PostCleanupPlan {
  const builderName = readBuilderName(getInput);
  const projectName = resolveProjectName(builderName, projectNameOverride);
  return {
    args: buildComposeDownArgs({ composeFile, projectName }),
    env: { ...env, BUILDER_NAME: builderName },
  };
}

export interface BuildDockerCpArgsOptions {
  containerName: string;
  containerPath: string;
  hostPath: string;
}

export function buildDockerCpArgs({
  containerName,
  containerPath,
  hostPath,
}: BuildDockerCpArgsOptions): string[] {
  return ["cp", `${containerName}:${containerPath}`, hostPath];
}

/**
 * Build the `docker compose ... up`/`down` argv, shared by setup and run's
 * main/post steps.
 *
 * `-p projectName` is required on both so that fully concurrent steps in
 * the same job (see GitHub Actions' `background`/`wait`/`parallel` step
 * keywords) never share Compose's implicit, directory-derived project name
 * — see compose-project-name.ts's deriveProjectName for why that matters.
 */
export interface ComposeArgsOptions {
  composeFile: string;
  projectName: string;
}

export interface BuildComposeUpArgsOptions extends ComposeArgsOptions {
  pullPolicy: string;
}

export function buildComposeUpArgs({
  composeFile,
  projectName,
  pullPolicy,
}: BuildComposeUpArgsOptions): string[] {
  return [
    "compose",
    "-f",
    composeFile,
    "-p",
    projectName,
    "up",
    "-d",
    "--pull",
    pullPolicy,
    "--no-build",
    "--wait",
    "--quiet-pull",
  ];
}

/** Build the `docker compose ... down` argv — see buildComposeUpArgs above. */
export function buildComposeDownArgs({ composeFile, projectName }: ComposeArgsOptions): string[] {
  return ["compose", "-f", composeFile, "-p", projectName, "down"];
}

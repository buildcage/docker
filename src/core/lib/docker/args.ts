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

export interface ComposeArgsOptions {
  composeFile: string;
  projectName: string;
}

export interface BuildComposeUpArgsOptions extends ComposeArgsOptions {
  pullPolicy: string;
}

/** Bounds the `--wait` phase, image pull excluded. Compose gives up on its own
 *  once a container reports unhealthy, so this only catches one that stays
 *  "starting" forever. */
const WAIT_TIMEOUT_SECONDS = 180;

/**
 * Build the `docker compose ... up`/`down` argv, shared by an action's main
 * and post steps.
 *
 * `-p projectName` is required on both so that fully concurrent steps in
 * the same job (see GitHub Actions' `background`/`wait`/`parallel` step
 * keywords) never share Compose's implicit, directory-derived project name;
 * see compose-project-name.ts's deriveProjectName for why that matters.
 */
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
    "--wait-timeout",
    String(WAIT_TIMEOUT_SECONDS),
    "--quiet-pull",
  ];
}

export interface BuildComposeLogsArgsOptions extends ComposeArgsOptions {
  tail: number;
}

/** Build the `docker compose ... logs` argv. Goes through Compose rather than
 *  `docker logs` so it still reads a container that has exited. */
export function buildComposeLogsArgs({
  composeFile,
  projectName,
  tail,
}: BuildComposeLogsArgsOptions): string[] {
  return [
    "compose",
    "-f",
    composeFile,
    "-p",
    projectName,
    "logs",
    "--no-color",
    "--tail",
    String(tail),
  ];
}

/**
 * Build the `docker compose ... down` argv; see buildComposeUpArgs above.
 * `-v` removes the anonymous volume an image's VOLUME gets on each `up`
 * (moby/buildkit's /var/lib/buildkit), which would otherwise pile up.
 */
export function buildComposeDownArgs({ composeFile, projectName }: ComposeArgsOptions): string[] {
  return ["compose", "-f", composeFile, "-p", projectName, "down", "-v"];
}

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

/**
 * Parses `docker inspect <id> --format '{{json .Config.Env}}'`'s output — a
 * JSON array of "KEY=VALUE" strings — into a lookup map. Used to read a
 * running container's own env from the runner side (report-action.node.ts
 * doesn't run inside the container, so it can't read process.env directly).
 */
export function parseDockerInspectEnv(inspectOutput: string): Record<string, string> {
  const entries: string[] = JSON.parse(inspectOutput);
  const env: Record<string, string> = {};
  for (const entry of entries) {
    const i = entry.indexOf("=");
    if (i === -1) continue;
    env[entry.slice(0, i)] = entry.slice(i + 1);
  }
  return env;
}

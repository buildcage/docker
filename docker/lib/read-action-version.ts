import type { Docker } from "#core/lib/docker/client.ts";

/** Best-effort `org.opencontainers.image.version` label read — a `docker
 *  inspect` failure here must not fail the whole report over one comment. */
export function readActionVersion(docker: Docker, containerId: string): string | undefined {
  try {
    return docker.readLabels(containerId)["org.opencontainers.image.version"];
  } catch {
    return undefined;
  }
}

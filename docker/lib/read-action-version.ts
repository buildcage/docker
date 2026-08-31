import type { Docker } from "#core/lib/docker/client.ts";

/**
 * Best-effort `org.opencontainers.image.version` label read, converted back
 * into the `vX.Y.Z` git tag it was published from (the label itself is the
 * bare Docker tag, e.g. `3.1.4-inspect` for a non-universal engine — see
 * image-tag.ts). A `docker inspect` failure here must not fail the whole
 * report over one comment.
 */
export function readActionVersion(
  docker: Docker,
  containerId: string,
  proxyEngine: string,
): string | undefined {
  try {
    const label = docker.readLabels(containerId)["org.opencontainers.image.version"];
    if (!label) return undefined;
    const suffix = `-${proxyEngine}`;
    const version = label.endsWith(suffix) ? label.slice(0, -suffix.length) : label;
    return `v${version}`;
  } catch {
    return undefined;
  }
}

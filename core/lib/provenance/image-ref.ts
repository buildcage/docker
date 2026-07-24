/**
 * Resolve the buildcage Docker image reference (image@digest). The
 * repository is always derived from the action repository — external image
 * overrides are intentionally not supported to preserve Sigstore verification
 * integrity.
 *
 * Kept in its own module (rather than inside setup/src/main.ts) so other
 * entry points (e.g. run/src/main.ts) can reuse it without also
 * bundling setup/src/main.ts's own self-invocation guard.
 */
export interface ResolveBuildcageImageRefOptions {
  imageDigest: string;
  actionRepository: string;
}

export function resolveBuildcageImageRef({
  imageDigest,
  actionRepository,
}: ResolveBuildcageImageRefOptions): string {
  const repository = `ghcr.io/${actionRepository}`.toLowerCase();
  // Pull by verified digest to close the TOCTOU window between verification and docker pull.
  return `${repository}@${imageDigest}`;
}

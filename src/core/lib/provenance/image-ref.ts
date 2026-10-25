/**
 * Resolve the buildcage Docker image reference (image@digest). The
 * repository is always derived from the action repository: external image
 * overrides are intentionally not supported to preserve Sigstore verification
 * integrity.
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

/**
 * Resolve the buildcage Docker image reference (image@digest). The
 * repository is always derived from the action repository — external image
 * overrides are intentionally not supported to preserve Sigstore verification
 * integrity.
 *
 * Kept in its own module (rather than inside setup/src/main.js) so
 * sandbox/src/main.js can reuse it without pulling in the rest of
 * setup/src/main.js — importing that file directly would bundle its
 * top-level `if (process.argv[1] === fileURLToPath(import.meta.url))`
 * self-invocation guard too, which breaks once rollup merges both files'
 * `import.meta.url` into a single sandbox/dist/main.cjs: both guards then
 * compare against the same bundled file and both mains fire.
 */
export function resolveBuildcageImageRef({ imageDigest, actionRepository }) {
  const repository = `ghcr.io/${actionRepository}`.toLowerCase();
  // Pull by verified digest to close the TOCTOU window between verification and docker pull.
  return `${repository}@${imageDigest}`;
}

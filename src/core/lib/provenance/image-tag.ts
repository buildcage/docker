export function engineTagSuffix(proxyEngine: string): string {
  return `-${proxyEngine}`;
}

/**
 * The Docker image tag docker-publish.yml pushes for a commit's build, e.g.
 * `sha-<commit>-inspect`.
 *
 * Every engine's tag carries its own `-<engine>` suffix. The suffix is not part
 * of the Sigstore identity; engine-label.ts is what binds the resolved image to
 * the requested engine.
 */
export function imageTagForCommit(commit: string, proxyEngine: string): string {
  return `sha-${commit}${engineTagSuffix(proxyEngine)}`;
}

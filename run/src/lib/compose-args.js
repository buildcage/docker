// @ts-nocheck
/**
 * Build the `docker compose ... up`/`down` argv. Kept in its own module
 * (rather than inside run/src/main.js) so post.js can reuse it without
 * also bundling main.js's self-invocation guard — importing main.js
 * directly would pull in its
 * `if (process.argv[1] === fileURLToPath(import.meta.url))` check too,
 * which fires a second time once rollup merges both files'
 * `import.meta.url` into a single bundle (see core/lib/provenance/image-ref.js
 * for the same issue hit previously).
 *
 * `-p projectName` is required on both so that fully concurrent `run`
 * steps in the same job (see GitHub Actions' `background`/`wait`/`parallel`
 * step keywords) never share Compose's implicit, directory-derived project
 * name — see lib/container.js's deriveProjectName for why that matters.
 */
export function buildComposeUpArgs({ composeFile, projectName, pullPolicy }) {
  return ["compose", "-f", composeFile, "-p", projectName, "up", "-d", "--pull", pullPolicy, "--no-build", "--wait", "--quiet-pull"];
}

/** Build the `docker compose ... down` argv — see buildComposeUpArgs above. */
export function buildComposeDownArgs({ composeFile, projectName }) {
  return ["compose", "-f", composeFile, "-p", projectName, "down"];
}

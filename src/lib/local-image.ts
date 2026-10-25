/**
 * The local-image override that replaces a verified, digest-pinned image, or
 * null in a normal build.
 */
import type { LocalImageOverride } from "../core/lib/provenance/local-image-override.ts";

/**
 * Gates a local-image override used only by this repo's own CI/dev testing
 * (the setup_buildkit_* targets the integration tests run, test_action in
 * .github/workflows/test-e2e.yml, and verify-image in docker-publish.yml, where
 * the image is not signed yet), never by a consumer
 * of a published action. rolldown's replacePlugin substitutes
 * BUILDCAGE_BUILD_TEST_HOOKS with the build's own env, so without that flag the
 * condition is constant-false and the dynamic import below is tree-shaken out
 * of dist entirely; see rolldown.config.js. The unit_test CI job also greps
 * the built output as a backstop.
 */
export async function readLocalImageOverride(
  env: NodeJS.ProcessEnv,
  log: (message: string) => void = console.log,
): Promise<LocalImageOverride | null> {
  if (process.env.BUILDCAGE_BUILD_TEST_HOOKS !== "1") return null;
  const override = (
    await import("../core/lib/provenance/local-image-override.ts")
  ).readLocalImageOverride(env);
  // Said here rather than by the caller so a normal build carries neither the
  // message nor the module it describes.
  if (override) {
    log(
      `BUILDCAGE_LOCAL_IMAGE_REF is set (${JSON.stringify(override.imageRef)}): ` +
        `skipping image provenance verification and registry tag resolution entirely. ` +
        `This bypass exists only for buildcage's own CI self-tests and local development and is ` +
        `dead-code-eliminated from every published release build.`,
    );
  }
  return override;
}

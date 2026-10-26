export interface LocalImageOverride {
  imageRef: string;
  pullPolicy: "never";
  /** BUILDCAGE_TEST_COMPOSE_OVERLAY: layered on docker/compose.action.yaml for
   *  integration tests that join the container to a test-only network. */
  composeOverlay: string | undefined;
}

/**
 * Kept in its own module so a normal build can exclude it entirely; see where
 * each action's src/lib imports it dynamically.
 */
export function readLocalImageOverride(env: NodeJS.ProcessEnv): LocalImageOverride | null {
  const ref = env.BUILDCAGE_LOCAL_IMAGE_REF;
  if (!ref) return null;
  return { imageRef: ref, pullPolicy: "never", composeOverlay: env.BUILDCAGE_TEST_COMPOSE_OVERLAY };
}

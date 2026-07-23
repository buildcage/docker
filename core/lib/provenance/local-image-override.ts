// @ts-nocheck
/**
 * Reads BUILDCAGE_LOCAL_IMAGE_REF from the given env. Kept in its own module
 * so a normal build can exclude it entirely — see LOCAL_IMAGE_OVERRIDE_ENABLED
 * in main.js.
 */
export function readLocalImageOverride(env) {
  const ref = env.BUILDCAGE_LOCAL_IMAGE_REF;
  if (!ref) return null;
  return { imageRef: ref, pullPolicy: "never" };
}

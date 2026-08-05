import { createHash } from "node:crypto";

/**
 * An explicit, deterministic Compose project name, so concurrent
 * `up`/`down`/`ps` from different steps in the same job never collide on
 * Compose's shared, directory-derived default.
 *
 * Hashed rather than used verbatim: Compose project names are constrained
 * to `^[a-z0-9][a-z0-9_-]*$`, but the input can be a wider-charset
 * user-supplied `builder_name` — a hex digest is always in-charset
 * regardless, so this never needs to validate its input.
 */
export function deriveProjectName(containerName: string): string {
  const hash = createHash("sha256").update(containerName).digest("hex").slice(0, 12);
  return `buildcage-${hash}`;
}

/** Compose project name for a builder_name, preferring an explicit override
 *  over the deterministic hash-derived name. */
export function resolveProjectName(
  builderName: string,
  composeProjectNameOverride: string | undefined,
): string {
  return composeProjectNameOverride || deriveProjectName(builderName);
}

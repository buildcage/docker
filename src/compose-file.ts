import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Kept beside the entry points, so it resolves the same from src/ as from the
// bundles in dist/: both sit next to docker/.
const __dirname = dirname(fileURLToPath(import.meta.url));

/** The compose file the setup and post steps start and remove the builder with. */
export const COMPOSE_FILE = join(__dirname, "../docker/compose.action.yaml");

/** `composeFile`, with a test overlay layered on top when there is one. */
export function withComposeOverlay(composeFile: string, overlay: string | undefined): string[] {
  return overlay ? [composeFile, overlay] : [composeFile];
}

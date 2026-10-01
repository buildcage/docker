import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

const dockerDir = fileURLToPath(new URL("../../../../docker/", import.meta.url));

function filesUnder(dir: string): string[] {
  const root = join(dockerDir, dir, "files");
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => !entry.isDirectory())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)));
}

describe("engine image files", () => {
  const common = filesUnder("common");

  for (const engine of ["universal", "inspect"]) {
    it(`${engine} overrides nothing in common`, () => {
      // Each Dockerfile copies common first, so a path in both would silently
      // take the engine's copy.
      expect(filesUnder(engine).filter((path) => common.includes(path))).toEqual([]);
    });
  }
});

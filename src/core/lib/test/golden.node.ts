/**
 * Full-text comparison against a committed copy of a generator's output.
 *
 * haproxy.cfg, the Corefile and the report Markdown are what actually reach
 * HAProxy, CoreDNS and the Job Summary, and each is produced by one large
 * function. Assertions on substrings say that a directive is present; they
 * cannot say that nothing else moved. A committed full-text copy can, which is
 * what makes splitting those generators up a verifiable change rather than a
 * hopeful one.
 *
 * Node-only, unlike the rest of this directory: it reads the fixture off disk.
 * Nothing under acl/ imports it, so the qjs bundle never pulls it in.
 *
 * Refresh deliberately, after reading the diff the failure prints:
 *   UPDATE_GOLDEN=1 vp test run <path>
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { expect } from "vitest";

const updating = process.env.UPDATE_GOLDEN === "1";

/** `golden` is a URL so callers can write `new URL("./__fixtures__/x.cfg", import.meta.url)`
 *  and stay correct wherever vitest is invoked from. */
export function expectMatchesGolden(actual: string, golden: URL): void {
  const path = fileURLToPath(golden);

  if (updating) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, actual);
    return;
  }

  if (!existsSync(path)) {
    throw new Error(`No golden file at ${path}. Create it with UPDATE_GOLDEN=1.`);
  }

  expect(actual).toBe(readFileSync(path, "utf8"));
}

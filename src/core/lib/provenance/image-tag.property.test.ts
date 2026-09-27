import fc from "fast-check";
import { describe, it, expect } from "vitest";

import { imageTagFromRef } from "./image-tag.ts";

// Every engine appends `-<engine>`, so no published tag is engine-ambiguous.
const engines = fc.constantFrom("universal", "inspect", "explicit");

describe("imageTagFromRef: properties", () => {
  it("40-char hex SHA always produces sha-<lowercase sha>-<engine>", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[0-9a-fA-F]{40}$/), engines, (sha, engine) => {
        expect(imageTagFromRef(sha, engine)).toBe(`sha-${sha.toLowerCase()}-${engine}`);
      }),
    );
  });

  it("v-prefixed ref always strips the leading v and appends -<engine>", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).map((s) => `v${s}`),
        engines,
        (ref, engine) => {
          expect(imageTagFromRef(ref, engine)).toBe(`${ref.slice(1)}-${engine}`);
        },
      ),
    );
  });

  // Leading 'g' is not a hex char and not 'v', so this always hits the passthrough branch.
  it("non-SHA non-v-prefixed ref always passes through unchanged, then -<engine>", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 50 }).map((s) => `g${s}`),
        engines,
        (ref, engine) => {
          expect(imageTagFromRef(ref, engine)).toBe(`${ref}-${engine}`);
        },
      ),
    );
  });

  it("defaults to the inspect suffix when no engine is given", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 50 }).map((s) => `g${s}`),
        (ref) => {
          expect(imageTagFromRef(ref)).toBe(`${ref}-inspect`);
        },
      ),
    );
  });
});

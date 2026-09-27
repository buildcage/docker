import fc from "fast-check";
import { describe, it, expect } from "vitest";

import { resolveProxyEngine } from "./engine.ts";

describe("resolveProxyEngine: properties", () => {
  it("always returns one of the two canonical engine names, or throws", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 20 }), (input) => {
        let result;
        try {
          result = resolveProxyEngine(input);
        } catch {
          return; // throwing is an acceptable outcome for invalid input
        }
        expect(["universal", "inspect"]).toContain(result);
      }),
    );
  });

  it("is idempotent for its own valid outputs", () => {
    fc.assert(
      fc.property(fc.constantFrom("universal", "inspect"), (engine) => {
        expect(resolveProxyEngine(resolveProxyEngine(engine))).toBe(engine);
      }),
    );
  });
});

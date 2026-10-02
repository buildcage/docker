import { describe, it, expect } from "vitest";

import { resolveProxyEngine } from "./engine.ts";

describe("resolveProxyEngine", () => {
  it("rejects the removed explicit engine, naming the supported replacements", () => {
    expect(() => resolveProxyEngine("explicit")).toThrowError(
      /explicit has been removed.*universal.*inspect/s,
    );
  });

  it("leaves every other value to the shared resolver", () => {
    expect(resolveProxyEngine(undefined)).toBe("inspect");
    expect(resolveProxyEngine("universal")).toBe("universal");
    expect(() => resolveProxyEngine("Explicit")).toThrow(/Invalid proxy_engine/);
  });
});

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { PROXY_ADDRESS } from "./proxy-address.ts";

describe("PROXY_ADDRESS", () => {
  it("matches the gateway the inspect image's config generator echoes", () => {
    // init-inspect-cfg cannot import this, and a change there without one here
    // would make the parser name every name-based connection by the wrong
    // address. The network that hands out the gateway differs per action, so
    // each action guards its own with a test outside core.
    const script = readFileSync(
      new URL("../../../../docker/inspect/files/s6-scripts/init-inspect-cfg", import.meta.url),
      "utf8",
    );
    expect(script).toContain(`\nGATEWAY=${PROXY_ADDRESS}\n`);
  });
});

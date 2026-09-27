import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";

import { PROXY_ADDRESS } from "./proxy-address.ts";

describe("PROXY_ADDRESS", () => {
  it("matches the gateway the inspect image's config generator echoes", () => {
    // init-inspect-cfg cannot import this; a mismatch would make the parser
    // name every name-based connection by the wrong address.
    const script = readFileSync(
      new URL("../../../../docker/inspect/files/s6-scripts/init-inspect-cfg", import.meta.url),
      "utf8",
    );
    expect(script).toContain(`\nGATEWAY=${PROXY_ADDRESS}\n`);
  });
});

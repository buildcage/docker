import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { PROXY_ADDRESS } from "#core/lib/log/proxy-address.ts";

describe("PROXY_ADDRESS", () => {
  it("is the gateway the inspect engine's build network hands a name-based connection", () => {
    // The CNI gateway itself, the address the build actually dials. The CNI
    // config cannot import PROXY_ADDRESS, so changing one without the other
    // would make the parser name every name-based connection by an address
    // that is not the one it lands on.
    const conflist = readFileSync(
      new URL("../../docker/inspect/files/cni.conflist", import.meta.url),
      "utf8",
    );
    expect(conflist).toContain(`"gateway": "${PROXY_ADDRESS}"`);
  });
});

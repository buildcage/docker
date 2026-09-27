import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";

import { PROXY_ADDRESS } from "#core/lib/log/proxy-address.ts";

describe("PROXY_ADDRESS", () => {
  it("is the gateway the inspect engine's build network hands a name-based connection", () => {
    // cni.conflist cannot import PROXY_ADDRESS; a mismatch would make the
    // parser name every name-based connection by the wrong address.
    const conflist = readFileSync(
      new URL("../../docker/inspect/files/cni.conflist", import.meta.url),
      "utf8",
    );
    expect(conflist).toContain(`"gateway": "${PROXY_ADDRESS}"`);
  });
});

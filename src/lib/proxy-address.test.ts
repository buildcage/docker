import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";

import { PROXY_ADDRESS, PROXY_SUBNET } from "#core/lib/log/proxy-address.ts";

// Both engines' build network; it cannot import these constants.
const conflist = readFileSync(
  new URL("../../docker/common/files/cni.conflist", import.meta.url),
  "utf8",
);

describe("PROXY_ADDRESS", () => {
  it("is the gateway the build network hands a name-based connection", () => {
    // A mismatch would make the parser name every name-based connection by the
    // wrong address.
    expect(conflist).toContain(`"gateway": "${PROXY_ADDRESS}"`);
  });
});

describe("PROXY_SUBNET", () => {
  it("is the subnet the build network hands out", () => {
    // The internal-address guard refuses PROXY_SUBNET; a build network outside
    // it would leave the steps on it reachable by name.
    expect(conflist).toContain(`"subnet": "${PROXY_SUBNET}"`);
  });
});

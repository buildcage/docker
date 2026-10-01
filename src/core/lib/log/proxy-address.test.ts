import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";

import { PROXY_ADDRESS } from "./proxy-address.ts";

describe("PROXY_ADDRESS", () => {
  // The init scripts cannot import this; a mismatch would make the parser
  // name every name-based connection by the wrong address.
  for (const script of [
    "inspect/files/s6-scripts/init-inspect-cfg",
    "universal/files/s6-scripts/init-haproxy-cfg",
  ]) {
    it(`matches the gateway ${script} passes its config generator`, () => {
      const text = readFileSync(new URL(`../../../../docker/${script}`, import.meta.url), "utf8");
      expect(text).toContain(`\nGATEWAY=${PROXY_ADDRESS}\n`);
    });
  }
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseContainerIds } from "./main.ts";

describe("parseContainerIds", () => {
  it("splits one ID per line", () => {
    assert.deepEqual(parseContainerIds("abc123\ndef456\n"), ["abc123", "def456"]);
  });

  it("returns an empty array for empty output", () => {
    assert.deepEqual(parseContainerIds(""), []);
  });

  it("drops blank lines and trims whitespace", () => {
    assert.deepEqual(parseContainerIds("\n  abc123  \n\n"), ["abc123"]);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseContainerIds, shouldFailOnBlocked } from "./main.ts";

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

describe("shouldFailOnBlocked", () => {
  it("fails when restrict mode, blocked, and fail_on_blocked are all true", () => {
    assert.equal(shouldFailOnBlocked({ mode: "restrict", blocked: true }, true), true);
  });

  it("does not fail when fail_on_blocked is false", () => {
    assert.equal(shouldFailOnBlocked({ mode: "restrict", blocked: true }, false), false);
  });

  it("does not fail when blocked is false", () => {
    assert.equal(shouldFailOnBlocked({ mode: "restrict", blocked: false }, true), false);
  });

  it("does not fail when blocked is absent (e.g. no blocked connections at all)", () => {
    assert.equal(shouldFailOnBlocked({ mode: "restrict" }, true), false);
  });

  it("never fails in audit mode, even if blocked were somehow set", () => {
    assert.equal(shouldFailOnBlocked({ mode: "audit", blocked: true }, true), false);
  });

  it("never fails when mode is null (no proxy logs found)", () => {
    assert.equal(shouldFailOnBlocked({ mode: null, blocked: true }, true), false);
  });
});

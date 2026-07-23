import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ActionError } from "./action-error.ts";

describe("ActionError", () => {
  it("sets name, message, and code, and is an instanceof Error", () => {
    const err = new ActionError("msg", "CODE");
    assert.equal(err.name, "ActionError");
    assert.equal(err.message, "msg");
    assert.equal(err.code, "CODE");
    assert.ok(err instanceof Error);
  });

  it("derives name from the concrete subclass via new.target", () => {
    class FooError extends ActionError {}
    const err = new FooError("msg2", "CODE2");
    assert.equal(err.name, "FooError");
    assert.equal(err.message, "msg2");
    assert.equal(err.code, "CODE2");
    assert.ok(err instanceof ActionError);
  });
});

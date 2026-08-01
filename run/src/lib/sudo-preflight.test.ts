import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { describeSudoFailure } from "./sudo-preflight.ts";

describe("describeSudoFailure", () => {
  const noSlimRunner = { env: {}, exists: () => false };

  it("mirrors the docs' passwordless-sudo phrasing", () => {
    const msg = describeSudoFailure({ status: 1 }, noSlimRunner);
    assert.match(msg, /requires a Linux runner with passwordless sudo/);
  });

  it("includes captured stderr detail when present", () => {
    assert.match(
      describeSudoFailure({ status: 1, stderr: "sudo: a password is required" }, noSlimRunner),
      /a password is required/,
    );
  });

  it("adds a detection note when the runner looks like a container-based image", () => {
    const withNote = describeSudoFailure(
      { status: 1 },
      { env: { ImageOS: "Linux" }, exists: () => true },
    );
    const withoutNote = describeSudoFailure({ status: 1 }, noSlimRunner);
    assert.match(withNote, /Detected a container-based GitHub-hosted runner image/);
    assert.doesNotMatch(withoutNote, /Detected a container-based GitHub-hosted runner image/);
  });
});

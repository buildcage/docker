import { describe, it, expect } from "vitest";

import { describeSudoFailure } from "./sudo-preflight.ts";

describe("describeSudoFailure", () => {
  const noSlimRunner = { env: {}, exists: () => false };

  it("mirrors the docs' passwordless-sudo phrasing", () => {
    const msg = describeSudoFailure({ status: 1 }, noSlimRunner);
    expect(msg).toMatch(/requires a Linux runner with passwordless sudo/);
  });

  it("includes captured stderr detail when present", () => {
    expect(
      describeSudoFailure({ status: 1, stderr: "sudo: a password is required" }, noSlimRunner),
    ).toMatch(/a password is required/);
  });

  it("adds a detection note when the runner looks like a container-based image", () => {
    const withNote = describeSudoFailure(
      { status: 1 },
      { env: { ImageOS: "Linux" }, exists: () => true },
    );
    const withoutNote = describeSudoFailure({ status: 1 }, noSlimRunner);
    expect(withNote).toMatch(/Detected a container-based GitHub-hosted runner image/);
    expect(withoutNote).not.toMatch(/Detected a container-based GitHub-hosted runner image/);
  });
});

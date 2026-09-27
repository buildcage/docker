import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { readLocalImageOverride } from "./local-image.ts";

describe("readLocalImageOverride", () => {
  let previousHooks: string | undefined;

  beforeEach(() => {
    previousHooks = process.env.BUILDCAGE_BUILD_TEST_HOOKS;
  });

  afterEach(() => {
    if (previousHooks === undefined) delete process.env.BUILDCAGE_BUILD_TEST_HOOKS;
    else process.env.BUILDCAGE_BUILD_TEST_HOOKS = previousHooks;
  });

  // The published action is built without the flag, which is what lets
  // rolldown drop the override module from dist entirely.
  it("reads nothing without the build-time flag, whatever the runtime env says", async () => {
    delete process.env.BUILDCAGE_BUILD_TEST_HOOKS;

    expect(await readLocalImageOverride({ BUILDCAGE_LOCAL_IMAGE_REF: "local:dev" })).toBeNull();
  });

  it("reads the override from the given env in a test-hooks build", async () => {
    process.env.BUILDCAGE_BUILD_TEST_HOOKS = "1";
    const log = vi.fn();

    expect(
      await readLocalImageOverride({ BUILDCAGE_LOCAL_IMAGE_REF: "local:dev" }, log),
    ).toStrictEqual({ imageRef: "local:dev", pullPolicy: "never", composeFile: undefined });
    // Skipping provenance verification is the one thing a reader of the log
    // must not have to infer.
    expect(log.mock.calls[0][0]).toContain("skipping image provenance verification");
  });

  it("reads nothing, and says nothing, when the flag is set but the env names no image", async () => {
    process.env.BUILDCAGE_BUILD_TEST_HOOKS = "1";
    const log = vi.fn();

    expect(await readLocalImageOverride({}, log)).toBeNull();
    expect(log).not.toHaveBeenCalled();
  });
});

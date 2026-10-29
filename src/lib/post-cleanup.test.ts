import { describe, it, expect } from "vitest";

import { planPostCleanup, type PostCleanupPlan } from "./post-cleanup.ts";

const COMPOSE_FILE = "/action/docker/compose.action.yaml";

/** Stands in for core.getInput, which returns "" for anything unset. */
function inputs(values: Record<string, string> = {}): (name: string) => string {
  return (name) => values[name] ?? "";
}

/** The plan, failing the test when there is none. */
function plan(...args: Parameters<typeof planPostCleanup>): PostCleanupPlan {
  const result = planPostCleanup(...args);
  if (!result) throw new Error("expected a cleanup plan");
  return result;
}

describe("planPostCleanup", () => {
  it("takes down the project for the builder-name input", () => {
    const { args, env } = plan(
      COMPOSE_FILE,
      undefined,
      { PATH: "/usr/bin" },
      { getInput: inputs({ "builder-name": "second" }) },
    );

    expect(args).toStrictEqual([
      "compose",
      "-f",
      COMPOSE_FILE,
      "-p",
      "buildcage-16367aacb67a",
      "down",
      "-v",
    ]);
    expect(env).toStrictEqual({ PATH: "/usr/bin", BUILDER_NAME: "second" });
  });

  it("takes the name setup saved over the input, which config-file may have set", () => {
    const { env } = plan(
      COMPOSE_FILE,
      undefined,
      {},
      {
        savedBuilderName: "saved",
        getInput: inputs({ "builder-name": "second" }),
      },
    );

    expect(env.BUILDER_NAME).toBe("saved");
  });

  it("takes the saved name when config-file is set", () => {
    const { env } = plan(
      COMPOSE_FILE,
      undefined,
      {},
      { savedBuilderName: "saved", getInput: inputs({ "config-file": "buildcage.yml" }) },
    );

    expect(env.BUILDER_NAME).toBe("saved");
  });

  // The file may name a builder the input doesn't, and the input's could be
  // another job's.
  it("takes nothing down when config-file is set but setup saved no name", () => {
    expect(
      planPostCleanup(
        COMPOSE_FILE,
        undefined,
        {},
        { getInput: inputs({ "config-file": "buildcage.yml", "builder-name": "second" }) },
      ),
    ).toBeUndefined();
  });

  it("takes nothing down when setup refused the input's name", () => {
    expect(
      planPostCleanup(COMPOSE_FILE, undefined, {}, { getInput: inputs({ "builder-name": "a;b" }) }),
    ).toBeUndefined();
  });

  it("lets an unexpected error through", () => {
    const getInput = (name: string) => {
      if (name === "builder-name") throw new Error("boom");
      return "";
    };

    expect(() => planPostCleanup(COMPOSE_FILE, undefined, {}, { getInput })).toThrow("boom");
  });

  // Setup and report pin the same name for the default builder, so post takes
  // down the project they brought up.
  it("falls back to the default builder and its project when the input is unset", () => {
    const { args, env } = plan(COMPOSE_FILE, undefined, {}, { getInput: inputs() });

    expect(env.BUILDER_NAME).toBe("buildcage");
    expect(args).toContain("buildcage-eeb358f947ee");
  });

  // Layered as setup layered it, so the down also takes the overlay's fixtures.
  it("layers the test overlay setup started with on the compose file", () => {
    const { args } = plan(
      COMPOSE_FILE,
      undefined,
      {},
      {
        composeOverlay: "/repo/docker/compose.action.test-inspect.yaml",
        getInput: inputs({ "builder-name": "second" }),
      },
    );

    expect(args.slice(0, 5)).toStrictEqual([
      "compose",
      "-f",
      COMPOSE_FILE,
      "-f",
      "/repo/docker/compose.action.test-inspect.yaml",
    ]);
  });

  it("uses the override outright when this repo's own testing supplies one", () => {
    const { args } = plan(
      COMPOSE_FILE,
      "buildcage-e2e",
      {},
      { getInput: inputs({ "builder-name": "second" }) },
    );

    expect(args).toStrictEqual([
      "compose",
      "-f",
      COMPOSE_FILE,
      "-p",
      "buildcage-e2e",
      "down",
      "-v",
    ]);
  });
});

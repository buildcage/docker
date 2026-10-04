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
  it("takes down the project main.ts derived from the same builder_name", () => {
    const { args, env } = plan(
      COMPOSE_FILE,
      undefined,
      { PATH: "/usr/bin" },
      { getInput: inputs({ builder_name: "second" }) },
    );

    expect(args).toStrictEqual([
      "compose",
      "-f",
      COMPOSE_FILE,
      "-p",
      expect.any(String),
      "down",
      "-v",
    ]);
    expect(env).toStrictEqual({ PATH: "/usr/bin", BUILDER_NAME: "second" });
  });

  it("takes the name setup saved over the input, which config_file may have set", () => {
    const { env } = plan(
      COMPOSE_FILE,
      undefined,
      {},
      {
        savedBuilderName: "saved",
        getInput: inputs({ builder_name: "second" }),
      },
    );

    expect(env.BUILDER_NAME).toBe("saved");
  });

  it("takes the saved name when config_file is set", () => {
    const { env } = plan(
      COMPOSE_FILE,
      undefined,
      {},
      { savedBuilderName: "saved", getInput: inputs({ config_file: "buildcage.yml" }) },
    );

    expect(env.BUILDER_NAME).toBe("saved");
  });

  // The file may name a builder the input doesn't, and the input's could be
  // another job's.
  it("takes nothing down when config_file is set but setup saved no name", () => {
    expect(
      planPostCleanup(
        COMPOSE_FILE,
        undefined,
        {},
        { getInput: inputs({ config_file: "buildcage.yml", builder_name: "second" }) },
      ),
    ).toBeUndefined();
  });

  it("falls back to the default builder name when the input is unset", () => {
    const { env } = plan(COMPOSE_FILE, undefined, {}, { getInput: inputs() });

    expect(env.BUILDER_NAME).toBe("buildcage");
  });

  it("derives the same project name main.ts and report do for one builder", () => {
    const getInput = inputs({ builder_name: "second" });
    const first = plan(COMPOSE_FILE, undefined, {}, { getInput });
    const second = plan(COMPOSE_FILE, undefined, {}, { getInput });

    expect(first.args).toStrictEqual(second.args);
  });

  it("uses the override outright when this repo's own testing supplies one", () => {
    const { args } = plan(
      COMPOSE_FILE,
      "buildcage-e2e",
      {},
      { getInput: inputs({ builder_name: "second" }) },
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

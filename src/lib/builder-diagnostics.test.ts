import { describe, it, expect, vi } from "vitest";

import { builderStartError, type BuilderDiagnosticsDeps } from "./builder-diagnostics.ts";
import { SetupError } from "./errors.ts";

const OPTIONS = {
  composeFiles: [
    "/action/docker/compose.action.yaml",
    "/repo/docker/compose.action.test-universal.yaml",
  ],
  projectName: "buildcage",
  builderName: "buildcage",
  composeEnv: { BUILDER_NAME: "buildcage" },
};

const COMPOSE_UP_FAILED = Object.assign(new Error("exit 1"), { status: 1, stderr: "" });

/** A container that came up but never passed its healthcheck. */
const UNHEALTHY_STATE = JSON.stringify({
  Status: "running",
  ExitCode: 0,
  Health: { Status: "unhealthy", Log: [{ Output: "haproxy is not listening yet" }] },
});

/** Records every docker invocation, so one fake covers both seams. */
function fakeDocker(overrides: { state?: string | Error; log?: Error } = {}): {
  deps: BuilderDiagnosticsDeps;
  calls: { args: string[]; env?: NodeJS.ProcessEnv }[];
} {
  const calls: { args: string[]; env?: NodeJS.ProcessEnv }[] = [];
  return {
    calls,
    deps: {
      captureDocker(args, env) {
        calls.push({ args, env });
        if (overrides.state instanceof Error) throw overrides.state;
        return overrides.state ?? "";
      },
      printDocker(args, env) {
        calls.push({ args, env });
        if (overrides.log) throw overrides.log;
      },
    },
  };
}

describe("builderStartError", () => {
  it("blames Docker itself when there is no container to ask", () => {
    const { deps, calls } = fakeDocker({ state: new Error("no container") });

    const error = builderStartError(COMPOSE_UP_FAILED, OPTIONS, deps);

    expect(error).toBeInstanceOf(SetupError);
    expect(error.code).toBe("DOCKER_UNAVAILABLE");
    expect(calls).toStrictEqual([
      {
        args: ["inspect", "--format", "{{json .State}}", "buildcage"],
        env: OPTIONS.composeEnv,
      },
    ]);
  });

  it("blames Docker itself when the inspect output is not a state object", () => {
    const { deps } = fakeDocker({ state: "" });

    expect(builderStartError(COMPOSE_UP_FAILED, OPTIONS, deps).code).toBe("DOCKER_UNAVAILABLE");
  });

  it("reports why the container is not ready, and prints its log", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { deps, calls } = fakeDocker({ state: UNHEALTHY_STATE });

    const error = builderStartError(COMPOSE_UP_FAILED, OPTIONS, deps);

    expect(error.code).toBe("BUILDER_NOT_READY");
    expect(error.message).toContain("haproxy is not listening yet");
    expect(calls[1]).toStrictEqual({
      args: [
        "compose",
        ...OPTIONS.composeFiles.flatMap((file) => ["-f", file]),
        "-p",
        OPTIONS.projectName,
        "logs",
        "--no-color",
        "--tail",
        "100",
      ],
      env: OPTIONS.composeEnv,
    });
    expect(log).toHaveBeenCalledWith("::group::buildcage: Builder container log");
    expect(log).toHaveBeenCalledWith("::endgroup::");
  });

  it("still reports why the container is not ready when its log cannot be read", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { deps } = fakeDocker({ state: UNHEALTHY_STATE, log: new Error("no such service") });

    expect(builderStartError(COMPOSE_UP_FAILED, OPTIONS, deps).code).toBe("BUILDER_NOT_READY");
    expect(log).toHaveBeenCalledWith("The builder container's log could not be read.");
  });

  it("stays quiet about the missing container it expects", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { deps } = fakeDocker({
      state: Object.assign(new Error("exit 1"), {
        stderr: "Error: No such object: buildcage\n",
      }),
    });

    builderStartError(COMPOSE_UP_FAILED, OPTIONS, deps);

    expect(log).not.toHaveBeenCalled();
  });

  it("surfaces any other reason the state could not be read", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { deps } = fakeDocker({
      state: Object.assign(new Error("exit 1"), {
        stderr: "  permission denied while trying to connect to the Docker daemon socket\n",
      }),
    });

    builderStartError(COMPOSE_UP_FAILED, OPTIONS, deps);

    expect(log).toHaveBeenCalledWith(
      "buildcage: could not read the builder container's state: " +
        "permission denied while trying to connect to the Docker daemon socket",
    );
  });
});

describe("builderStartError: an inspect failure that is not an Error", () => {
  it("blames Docker without trying to quote a stderr that is not there", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const deps: BuilderDiagnosticsDeps = {
      captureDocker() {
        throw "docker: command not found";
      },
      printDocker() {},
    };

    const error = builderStartError(COMPOSE_UP_FAILED, OPTIONS, deps);

    expect(error.code).toBe("DOCKER_UNAVAILABLE");
    expect(log.mock.calls.length).toBe(0);
  });
});

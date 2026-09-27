import { describe, it, expect } from "vitest";

import { ReportError } from "./errors.ts";
import { runReportScript } from "./run-report-script.ts";

const SCRIPT = "/tmp/buildcage-report-abc/report-action.js";
const CONTAINER_ID = "builder123";
const TRAFFIC_FILE = "/tmp/buildcage-report-abc/traffic.json";
const ENV = { PATH: "/usr/bin" };

/** Records every invocation's argv and env; throws `fail` if given. */
function fakeRun(fail?: unknown): {
  run: (args: string[], env: NodeJS.ProcessEnv) => void;
  calls: { args: string[]; env: NodeJS.ProcessEnv }[];
} {
  const calls: { args: string[]; env: NodeJS.ProcessEnv }[] = [];
  return {
    calls,
    run(args, env) {
      calls.push({ args, env });
      if (fail) throw fail;
    },
  };
}

function caught(call: () => unknown): ReportError {
  try {
    call();
  } catch (e) {
    return e as ReportError;
  }
  throw new Error("expected runReportScript to throw");
}

describe("runReportScript", () => {
  it("runs the script against the container and reports success as 0", () => {
    const { run, calls } = fakeRun();

    expect(runReportScript(SCRIPT, CONTAINER_ID, { env: ENV, run })).toBe(0);

    expect(calls).toStrictEqual([{ args: [SCRIPT, CONTAINER_ID], env: ENV }]);
  });

  it("names the traffic file in the environment when one is wanted", () => {
    const { run, calls } = fakeRun();

    runReportScript(SCRIPT, CONTAINER_ID, { trafficFile: TRAFFIC_FILE, env: ENV, run });

    expect(calls[0].env).toStrictEqual({ ...ENV, BUILDCAGE_TRAFFIC_FILE: TRAFFIC_FILE });
  });

  it("removes an inherited traffic file when no artifact is wanted", () => {
    const { run, calls } = fakeRun();
    const planted = { ...ENV, BUILDCAGE_TRAFFIC_FILE: "/home/runner/leak.json" };

    runReportScript(SCRIPT, CONTAINER_ID, { env: planted, run });

    expect(calls[0].env).toStrictEqual(ENV);
  });

  it("replaces an inherited traffic file with its own", () => {
    const { run, calls } = fakeRun();
    const planted = { ...ENV, BUILDCAGE_TRAFFIC_FILE: "/home/runner/leak.json" };

    runReportScript(SCRIPT, CONTAINER_ID, { trafficFile: TRAFFIC_FILE, env: planted, run });

    expect(calls[0].env).toStrictEqual({ ...ENV, BUILDCAGE_TRAFFIC_FILE: TRAFFIC_FILE });
  });

  // The script explains itself over inherited stdio, so the caller only has to
  // reproduce the number it chose.
  it("returns the status the script exited with", () => {
    const { run } = fakeRun(Object.assign(new Error("Command failed"), { status: 7 }));

    expect(runReportScript(SCRIPT, CONTAINER_ID, { env: ENV, run })).toBe(7);
  });

  it.each([
    ["a signal, which leaves status null", Object.assign(new Error("killed"), { status: null })],
    ["a failure to spawn at all", new Error("spawnSync node ENOENT")],
  ])("throws REPORT_SCRIPT_FAILED after %s", (_case, thrown) => {
    const { run } = fakeRun(thrown);

    const error = caught(() => runReportScript(SCRIPT, CONTAINER_ID, { env: ENV, run }));

    expect(error).toBeInstanceOf(ReportError);
    expect(error.code).toBe("REPORT_SCRIPT_FAILED");
  });

  // Nothing else printed it: the script never got as far as its own stdio.
  it("quotes the underlying failure", () => {
    const { run } = fakeRun(new Error("spawnSync node ENOENT"));

    const error = caught(() => runReportScript(SCRIPT, CONTAINER_ID, { env: ENV, run }));

    expect(error.message).toBe("Failed to run report-action.js: spawnSync node ENOENT");
  });
});

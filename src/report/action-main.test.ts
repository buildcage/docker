import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect, vi } from "vitest";

import type { Docker } from "#core/lib/docker/client.ts";
import type { InspectReportData, UniversalReportData } from "#core/lib/report/types.ts";
import { reportParams } from "#core/lib/test/report-data.node.ts";

import { runReportAction, type ReportActionSpec } from "./action-main.ts";

function fakeDocker(overrides: Partial<Docker> = {}): Docker {
  return {
    findContainers: () => [],
    copyFromContainer: () => {},
    readFileLines: () => (async function* () {})(),
    readEnv: () => ({ PROXY_MODE: "restrict" }),
    readLabels: () => ({ "org.opencontainers.image.version": "2.1.0" }),
    exec: () => "",
    ...overrides,
  };
}

const parameters = reportParams();
const universal: UniversalReportData = {
  engine: "universal",
  parameters,
  passed: [{ host: "a.example.com", port: "443", ruleType: "HTTPS", reason: "-", count: 1 }],
  blocked: [],
  failed: [],
  blockedCount: 0,
  logLooksPlausible: true,
  timeline: [],
  startedAt: undefined,
};

function spec(overrides: Partial<ReportActionSpec> = {}): ReportActionSpec {
  return { proxyEngine: "universal", build: () => universal, ...overrides };
}

/** The summary falls back to stdout when GITHUB_STEP_SUMMARY is unset, so the
 *  rendered markdown is readable straight off console.log. */
async function run(
  s: ReportActionSpec,
  deps: Parameters<typeof runReportAction>[1] = {},
): Promise<string[]> {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await runReportAction(s, {
      containerId: "abc123",
      docker: fakeDocker(),
      env: {},
      failOnBlocked: false,
      ...deps,
    });
    return log.mock.calls.map((c) => String(c[0]));
  } finally {
    log.mockRestore();
  }
}

describe("runReportAction", () => {
  it("renders the report from what the engine's build() returned", async () => {
    const lines = await run(spec());
    expect(lines.join("\n")).toMatch(/## Outbound Traffic Report/);
    expect(lines.join("\n")).toMatch(/a\.example\.com:443/);
  });

  it("hands build() the container id and the parameters read from its env", async () => {
    const seen: unknown[] = [];
    await run(
      spec({
        build: (_docker, containerId, params) => {
          seen.push(containerId, params.mode);
          return universal;
        },
      }),
    );
    expect(seen).toStrictEqual(["abc123", "restrict"]);
  });

  // Without an id there is no container to report on, and the message is what
  // the Makefile's report targets print when invoked wrongly.
  it("refuses to run without a container id", async () => {
    await expect(
      runReportAction(spec(), { containerId: "", docker: fakeDocker(), env: {} }),
    ).rejects.toThrow(/Usage: report-action\.js/);
  });

  it("falls back to the published action's own repo and ref when the env has neither", async () => {
    // An audit report's restrict example prints the repo and ref in `uses:`.
    const audit = { ...universal, parameters: reportParams({ mode: "audit" }) };
    const lines = await run(spec({ build: () => audit }));
    expect(lines.join("\n")).toMatch(/uses: buildcage\/docker@v4 /);
  });

  it("prefers the runner's GITHUB_ACTION_REPOSITORY over the fallback", async () => {
    const lines = await run(spec(), { env: { GITHUB_ACTION_REPOSITORY: "forked/docker" } });
    expect(lines.join("\n")).toMatch(/forked\/docker/);
  });

  it("prints the engine's own log sections before the summary", async () => {
    const lines = await run(
      spec({ logSections: () => ["::group::Extra", "body", "::endgroup::"] }),
    );
    expect(lines.slice(0, 3)).toStrictEqual(["::group::Extra", "body", "::endgroup::"]);
    expect(lines.length).toBeGreaterThan(3);
  });

  it("prints nothing extra for an engine with no log sections", async () => {
    const lines = await run(spec());
    expect(lines[0]).toMatch(/^## Outbound Traffic Report/);
  });
});

describe("runReportAction and the traffic file", () => {
  const inspect: InspectReportData = {
    engine: "inspect",
    parameters,
    passed: [],
    blocked: [],
    failed: [],
    blockedCount: 0,
    logLooksPlausible: true,
    timeline: [
      {
        time: 1787471975,
        action: "allow",
        protocol: "https",
        host: "a.example.com",
        port: 443,
        method: "GET",
        url: "https://a.example.com/x",
        status: 200,
      },
    ],
    startedAt: 1787471970,
  };

  // Async, so the directory outlives the awaited body rather than being
  // removed the moment fn() returns its promise.
  async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), "buildcage-action-main-"));
    try {
      await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("writes the traffic file when the action asked for one", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "traffic.json");
      await run(spec({ proxyEngine: "inspect", build: () => inspect }), {
        env: { BUILDCAGE_TRAFFIC_FILE: file },
      });
      expect(JSON.parse(readFileSync(file, "utf8"))).toHaveLength(1);
    });
  });

  it("writes nothing when the action did not ask for a traffic file", async () => {
    const lines = await run(spec({ proxyEngine: "inspect", build: () => inspect }), { env: {} });
    expect(lines.join("\n")).toMatch(/## Outbound Traffic Report/);
  });
});

const blockedReport: UniversalReportData = {
  ...universal,
  blocked: [
    {
      host: "bad.example.com",
      port: "443",
      ruleType: "HTTPS",
      reason: "https-not-allowed",
      count: 1,
      expected: false,
    },
  ],
  blockedCount: 1,
};

describe("runReportAction and the blocked outcome", () => {
  it("leaves the exit code alone when fail_on_blocked is off", async () => {
    const previous = process.exitCode;
    try {
      await run(spec({ build: () => blockedReport }), { failOnBlocked: false });
      expect(process.exitCode).toBe(previous);
    } finally {
      process.exitCode = previous;
    }
  });

  it("fails the step when fail_on_blocked is on and something was blocked", async () => {
    const previous = process.exitCode;
    try {
      await run(spec({ build: () => blockedReport }), { failOnBlocked: true });
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previous;
    }
  });
});

describe("runReportAction's fail_on_blocked fallback", () => {
  /** Runs without deps.failOnBlocked, so the action input is consulted. */
  async function runReadingInput(
    value?: string,
  ): Promise<{ exitCode: number | string | undefined; lines: string[] }> {
    const previousInput = process.env.INPUT_FAIL_ON_BLOCKED;
    const previousExit = process.exitCode;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    // core.warning writes here rather than through console.log.
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      if (value === undefined) delete process.env.INPUT_FAIL_ON_BLOCKED;
      else process.env.INPUT_FAIL_ON_BLOCKED = value;
      process.exitCode = 0;
      await runReportAction(spec({ build: () => blockedReport }), {
        containerId: "abc123",
        docker: fakeDocker(),
        env: {},
      });
      return { exitCode: process.exitCode, lines: stdout.mock.calls.map((c) => String(c[0])) };
    } finally {
      log.mockRestore();
      stdout.mockRestore();
      process.exitCode = previousExit;
      if (previousInput === undefined) delete process.env.INPUT_FAIL_ON_BLOCKED;
      else process.env.INPUT_FAIL_ON_BLOCKED = previousInput;
    }
  }

  it.each([
    { value: "false", exitCode: 0 },
    { value: "False", exitCode: 0 },
    { value: "FALSE", exitCode: 0 },
    { value: "true", exitCode: 1 },
    { value: "True", exitCode: 1 },
    { value: "TRUE", exitCode: 1 },
  ])("reads $value as the action supplied it", async ({ value, exitCode }) => {
    expect((await runReadingInput(value)).exitCode).toBe(exitCode);
  });

  // The integration scripts and the Makefile's report targets run the script
  // without action.yml's defaults.
  it("falls back to action.yml's own default when the input is absent", async () => {
    const { exitCode, lines } = await runReadingInput();
    expect(exitCode).toBe(1);
    expect(lines.some((l) => l.startsWith("::warning::"))).toBe(false);
  });

  it.each(["no", "0", "off"])("fails closed on %o, with a warning", async (value) => {
    const { exitCode, lines } = await runReadingInput(value);
    expect(exitCode).toBe(1);
    expect(lines).toContain(
      `::warning::Invalid fail_on_blocked: "${value}". Must be true or false. Reading it as true.\n`,
    );
  });
});

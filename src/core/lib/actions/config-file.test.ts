import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyConfigFile, ConfigFileError } from "./config-file.ts";

const INPUTS = {
  known: ["proxy_mode", "proxy_engine", "allowed_https_rules", "known_blocked_rules"],
  lists: ["allowed_https_rules", "known_blocked_rules"],
};

let root: string;
let workspace: string;

beforeEach(() => {
  // Real, as the paths applyConfigFile returns are: macOS's tmpdir is a symlink.
  root = realpathSync(mkdtempSync(join(tmpdir(), "config-file-")));
  workspace = join(root, "workspace");
  mkdirSync(workspace);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeConfig(text: string, name = "buildcage.yml"): string {
  writeFileSync(join(workspace, name), text);
  return name;
}

function envFor(path: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { GITHUB_WORKSPACE: workspace, INPUT_CONFIG_FILE: path, ...extra };
}

function expectError(env: NodeJS.ProcessEnv, code: string, message: string | RegExp): void {
  expect(() => applyConfigFile(env, INPUTS)).toThrow(
    expect.objectContaining({
      name: ConfigFileError.name,
      code,
      message: typeof message === "string" ? message : expect.stringMatching(message),
    }),
  );
}

describe("applyConfigFile", () => {
  it("does nothing without config_file", () => {
    const env = { INPUT_PROXY_MODE: "audit" };
    expect(applyConfigFile(env, INPUTS)).toBeUndefined();
    expect(env).toEqual({ INPUT_PROXY_MODE: "audit" });
  });

  it("fills an input the workflow left unset, and returns the file's path", () => {
    const env = envFor(writeConfig("proxy_mode: audit\n"));
    expect(applyConfigFile(env, INPUTS)).toEqual({
      path: join(workspace, "buildcage.yml"),
      summary: ["Inputs read from config_file buildcage.yml:", "  proxy_mode"],
    });
    expect(env.INPUT_PROXY_MODE).toBe("audit");
  });

  it("leaves an input the workflow set", () => {
    const env = envFor(writeConfig("proxy_mode: audit\n"), { INPUT_PROXY_MODE: "restrict" });
    expect(applyConfigFile(env, INPUTS)?.summary).toEqual([
      "Inputs read from config_file buildcage.yml:",
      "  proxy_mode (ignored: the workflow sets it)",
    ]);
    expect(env.INPUT_PROXY_MODE).toBe("restrict");
  });

  // The runner sets every declared input, an unset one to "".
  it("fills an input the workflow set to empty", () => {
    const env = envFor(writeConfig("proxy_engine: universal\n"), { INPUT_PROXY_ENGINE: "" });
    applyConfigFile(env, INPUTS);
    expect(env.INPUT_PROXY_ENGINE).toBe("universal");
  });

  it("appends a list input to the workflow's", () => {
    const env = envFor(
      writeConfig("allowed_https_rules: |\n  b.example.com:443\n  c.example.com:443\n"),
      { INPUT_ALLOWED_HTTPS_RULES: "a.example.com:443" },
    );
    expect(applyConfigFile(env, INPUTS)?.summary).toEqual([
      "Inputs read from config_file buildcage.yml:",
      "  allowed_https_rules (added to the workflow's)",
    ]);
    expect(env.INPUT_ALLOWED_HTTPS_RULES).toBe(
      "a.example.com:443\nb.example.com:443\nc.example.com:443\n",
    );
  });

  it("takes a list input from the file alone when the workflow has none", () => {
    const env = envFor(writeConfig("known_blocked_rules: t.example.com\n"));
    expect(applyConfigFile(env, INPUTS)?.summary).toEqual([
      "Inputs read from config_file buildcage.yml:",
      "  known_blocked_rules",
    ]);
    expect(env.INPUT_KNOWN_BLOCKED_RULES).toBe("t.example.com");
  });

  it("keeps the workflow's list input when the file's is empty", () => {
    const env = envFor(writeConfig("allowed_https_rules:\n"), {
      INPUT_ALLOWED_HTTPS_RULES: "a.example.com:443",
    });
    applyConfigFile(env, INPUTS);
    expect(env.INPUT_ALLOWED_HTTPS_RULES).toBe("a.example.com:443");
  });

  it.each([
    ["true", "true"],
    ["7", "7"],
    ["", ""],
  ])("reads the scalar %o as the input text %o", (yaml, text) => {
    const env = envFor(writeConfig(`proxy_mode: ${yaml}\n`));
    applyConfigFile(env, INPUTS);
    expect(env.INPUT_PROXY_MODE).toBe(text);
  });

  it("accepts an empty file", () => {
    const env = envFor(writeConfig(""));
    expect(applyConfigFile(env, INPUTS)?.summary).toEqual([
      "Inputs read from config_file buildcage.yml:",
    ]);
  });

  it("trims the path", () => {
    const env = envFor(` ${writeConfig("proxy_mode: audit\n")}\n`);
    applyConfigFile(env, INPUTS);
    expect(env.INPUT_PROXY_MODE).toBe("audit");
  });

  it("reads a file in a subdirectory", () => {
    mkdirSync(join(workspace, "svc"));
    const env = envFor(writeConfig("proxy_mode: audit\n", "svc/buildcage.yml"));
    applyConfigFile(env, INPUTS);
    expect(env.INPUT_PROXY_MODE).toBe("audit");
  });

  it("falls back to the working directory without GITHUB_WORKSPACE", () => {
    const cwd = process.cwd();
    process.chdir(workspace);
    try {
      const env = { INPUT_CONFIG_FILE: writeConfig("proxy_mode: audit\n") };
      applyConfigFile(env, INPUTS);
      expect(env).toHaveProperty("INPUT_PROXY_MODE", "audit");
    } finally {
      process.chdir(cwd);
    }
  });

  describe("on an untrusted event", () => {
    it.each(["pull_request_target", "issue_comment"])("refuses %s", (event) => {
      expectError(
        envFor(writeConfig("proxy_mode: audit\n"), { GITHUB_EVENT_NAME: event }),
        "CONFIG_FILE_UNTRUSTED_EVENT",
        `config_file cannot be used on ${event}: the workspace may hold a pull ` +
          "request's code, which could then rewrite its own rules. Set the inputs in the " +
          "workflow instead.",
      );
    });

    function workflowRun(payload: string): NodeJS.ProcessEnv {
      const eventPath = join(root, "event.json");
      writeFileSync(eventPath, payload);
      return envFor(writeConfig("proxy_mode: audit\n"), {
        GITHUB_EVENT_NAME: "workflow_run",
        GITHUB_EVENT_PATH: eventPath,
      });
    }

    it.each([
      "pull_request",
      "pull_request_target",
      "pull_request_review",
      "issue_comment",
      "workflow_run",
    ])("refuses workflow_run triggered by %s", (event) => {
      expectError(
        workflowRun(JSON.stringify({ workflow_run: { event } })),
        "CONFIG_FILE_UNTRUSTED_EVENT",
        new RegExp(`^config_file cannot be used on workflow_run triggered by ${event}: `),
      );
    });

    it.each([
      ["no trigger event", JSON.stringify({ workflow_run: {} })],
      ["a non-string trigger event", JSON.stringify({ workflow_run: { event: 1 } })],
      ["no workflow_run", "{}"],
    ])("refuses workflow_run with %s", (_, payload) => {
      expectError(
        workflowRun(payload),
        "CONFIG_FILE_UNTRUSTED_EVENT",
        /^config_file cannot be used on workflow_run with no triggering event: /,
      );
    });

    it("allows workflow_run triggered by push", () => {
      const env = workflowRun(JSON.stringify({ workflow_run: { event: "push" } }));
      applyConfigFile(env, INPUTS);
      expect(env.INPUT_PROXY_MODE).toBe("audit");
    });

    it("refuses workflow_run when its payload can't be read", () => {
      expectError(
        envFor(writeConfig("proxy_mode: audit\n"), { GITHUB_EVENT_NAME: "workflow_run" }),
        "CONFIG_FILE_UNTRUSTED_EVENT",
        /^config_file cannot be used: the workflow_run event payload could not be read \(/,
      );
    });

    it.each(["pull_request", "workflow_dispatch"])("allows %s", (event) => {
      const env = envFor(writeConfig("proxy_mode: audit\n"), { GITHUB_EVENT_NAME: event });
      applyConfigFile(env, INPUTS);
      expect(env.INPUT_PROXY_MODE).toBe("audit");
    });

    // The inputs alone come from the default branch, so they stay usable.
    it("leaves a run without config_file alone", () => {
      const env = { GITHUB_EVENT_NAME: "pull_request_target", INPUT_PROXY_MODE: "audit" };
      expect(applyConfigFile(env, INPUTS)).toBeUndefined();
    });
  });

  describe("refuses a path", () => {
    it("that is absolute", () => {
      expectError(
        envFor(join(workspace, writeConfig("proxy_mode: audit\n"))),
        "CONFIG_FILE_PATH",
        `config_file ${JSON.stringify(join(workspace, "buildcage.yml"))} must be relative to the workspace.`,
      );
    });

    it("that does not exist", () => {
      expectError(
        envFor("missing.yml"),
        "CONFIG_FILE_PATH",
        'config_file "missing.yml" was not found in the workspace. ' +
          "Check out the repository in an earlier step.",
      );
    });

    it("that climbs out of the workspace", () => {
      writeFileSync(join(root, "outside.yml"), "proxy_mode: audit\n");
      expectError(
        envFor("../outside.yml"),
        "CONFIG_FILE_PATH",
        'config_file "../outside.yml" leads outside the workspace.',
      );
    });

    it("that is the workspace itself", () => {
      expectError(envFor("."), "CONFIG_FILE_PATH", /^config_file "\." could not be read: /);
    });
  });

  describe("symlinks", () => {
    it("follows a symlink that stays in the workspace", () => {
      writeConfig("proxy_mode: audit\n", "real.yml");
      symlinkSync(join(workspace, "real.yml"), join(workspace, "link.yml"));
      const env = envFor("link.yml");
      expect(applyConfigFile(env, INPUTS)?.path).toBe(join(workspace, "real.yml"));
      expect(env.INPUT_PROXY_MODE).toBe("audit");
    });

    it("follows a workspace reached through a symlink", () => {
      writeConfig("proxy_mode: audit\n");
      symlinkSync(workspace, join(root, "linked-workspace"));
      const env = {
        GITHUB_WORKSPACE: join(root, "linked-workspace"),
        INPUT_CONFIG_FILE: "buildcage.yml",
      };
      expect(applyConfigFile(env, INPUTS)?.path).toBe(join(workspace, "buildcage.yml"));
    });

    it("refuses a symlink out of the workspace", () => {
      writeFileSync(join(root, "outside.yml"), "proxy_mode: audit\n");
      symlinkSync(join(root, "outside.yml"), join(workspace, "link.yml"));
      expectError(
        envFor("link.yml"),
        "CONFIG_FILE_PATH",
        'config_file "link.yml" leads outside the workspace.',
      );
    });
  });

  describe("refuses a file", () => {
    it.each([
      ["that is not YAML", "proxy_mode: [\n", /^Invalid config_file "buildcage.yml": /],
      [
        "with a duplicate key",
        "proxy_mode: audit\nproxy_mode: restrict\n",
        /^Invalid config_file "buildcage.yml": Map keys must be unique/,
      ],
      [
        "whose top level is a list",
        "- proxy_mode\n",
        'Invalid config_file "buildcage.yml": the top level must be a mapping of input names to values.',
      ],
      [
        "whose top level is a string",
        "proxy_mode\n",
        'Invalid config_file "buildcage.yml": the top level must be a mapping of input names to values.',
      ],
      [
        "with an unknown key",
        "proxy_mod: audit\n",
        'Invalid config_file "buildcage.yml": unknown key "proxy_mod". Allowed keys: ' +
          "proxy_mode, proxy_engine, allowed_https_rules, known_blocked_rules.",
      ],
      [
        "with a list value",
        "allowed_https_rules:\n  - a.example.com:443\n",
        'Invalid config_file "buildcage.yml": allowed_https_rules must be a string, as it would be in the workflow.',
      ],
      [
        "with a mapping value",
        "proxy_mode:\n  value: audit\n",
        'Invalid config_file "buildcage.yml": proxy_mode must be a string, as it would be in the workflow.',
      ],
    ])("%s", (_, text, message) => {
      expectError(envFor(writeConfig(text)), "CONFIG_FILE_INVALID", message);
    });
  });

  it("changes nothing when the file is refused", () => {
    const env = envFor(writeConfig("proxy_mode: audit\nproxy_mod: x\n"));
    expect(() => applyConfigFile(env, INPUTS)).toThrow(ConfigFileError);
    expect(env.INPUT_PROXY_MODE).toBeUndefined();
  });
});

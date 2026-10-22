import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
      origins: new Map([["proxy_mode", { offset: 0, line: 1 }]]),
    });
    expect(env.INPUT_PROXY_MODE).toBe("audit");
  });

  describe("origins", () => {
    it("places a list input's file lines after the workflow's", () => {
      const env = envFor(
        writeConfig("proxy_mode: audit\nallowed_https_rules: |\n  b.example.com:443\n"),
        { INPUT_ALLOWED_HTTPS_RULES: "a.example.com:443\n# a comment\n" },
      );
      expect(applyConfigFile(env, INPUTS)?.origins.get("allowed_https_rules")).toEqual({
        offset: 3,
        line: 3,
      });
      expect(env.INPUT_ALLOWED_HTTPS_RULES!.split("\n")[3]).toBe("b.example.com:443");
    });

    it("starts a list input at the file's lines when the workflow has none", () => {
      const env = envFor(writeConfig("\nknown_blocked_rules: t.example.com\n"), {
        INPUT_KNOWN_BLOCKED_RULES: " ",
      });
      expect(applyConfigFile(env, INPUTS)?.origins).toEqual(
        new Map([["known_blocked_rules", { offset: 0, line: 2 }]]),
      );
    });

    it("puts a block's value on the lines after its header", () => {
      const env = envFor(writeConfig("known_blocked_rules: |\n  t.example.com\n"));
      expect(applyConfigFile(env, INPUTS)?.origins.get("known_blocked_rules")).toEqual({
        offset: 0,
        line: 2,
      });
    });

    it("gives no line for a value whose lines YAML may have joined", () => {
      const env = envFor(
        writeConfig(
          'allowed_https_rules: "a.example.com:443\\nb.example.com:443"\n' +
            "known_blocked_rules: >\n  t.example.com\n  u.example.com\n",
        ),
      );
      expect(applyConfigFile(env, INPUTS)?.origins).toEqual(
        new Map([
          ["allowed_https_rules", { offset: 0 }],
          ["known_blocked_rules", { offset: 0 }],
        ]),
      );
      expect(env.INPUT_ALLOWED_HTTPS_RULES).toBe("a.example.com:443\nb.example.com:443");
    });

    it("puts an alias's value where its anchor's is", () => {
      const env = envFor(
        writeConfig(
          "allowed_https_rules: &r |\n  a.example.com:443\n  b.example.com:443\n" +
            "known_blocked_rules: *r\n",
        ),
      );
      expect(applyConfigFile(env, INPUTS)?.origins.get("known_blocked_rules")).toEqual({
        offset: 0,
        line: 2,
      });
    });

    it("puts a merged value where its map has it, the map's own and the first merged winning", () => {
      const env = envFor(
        writeConfig(
          "%YAML 1.1\n---\n<<:\n  - &m {proxy_mode: audit}\n" +
            "  - {proxy_mode: restrict, proxy_engine: inspect}\n  - *m\n" +
            "<<: {known_blocked_rules: t.example.com}\nknown_blocked_rules: u.example.com\n",
        ),
      );
      expect(applyConfigFile(env, INPUTS)?.origins).toEqual(
        new Map([
          ["proxy_mode", { offset: 0, line: 4 }],
          ["proxy_engine", { offset: 0, line: 5 }],
          ["known_blocked_rules", { offset: 0, line: 8 }],
        ]),
      );
      expect(env).toMatchObject({
        INPUT_PROXY_MODE: "audit",
        INPUT_PROXY_ENGINE: "inspect",
        INPUT_KNOWN_BLOCKED_RULES: "u.example.com",
      });
    });

    it("finds a value merged as yaml merges it, under a tagged key or from an aliased list", () => {
      const env = envFor(
        writeConfig(
          "%YAML 1.1\n---\n!!str <<: {proxy_mode: audit}\n" +
            "<<: {known_blocked_rules: &s [{proxy_engine: inspect}]}\n" +
            "known_blocked_rules: t.example.com\n<<: *s\n",
        ),
      );
      expect(applyConfigFile(env, INPUTS)?.origins).toEqual(
        new Map([
          ["proxy_mode", { offset: 0, line: 3 }],
          ["known_blocked_rules", { offset: 0, line: 5 }],
          ["proxy_engine", { offset: 0, line: 4 }],
        ]),
      );
    });

    it("finds a value whose key is an alias", () => {
      const env = envFor(writeConfig("proxy_mode: &k proxy_engine\n*k : inspect\n"));
      expect(applyConfigFile(env, INPUTS)?.origins.get("proxy_engine")).toEqual({
        offset: 0,
        line: 2,
      });
      expect(env.INPUT_PROXY_ENGINE).toBe("inspect");
    });

    it("gives no line for a quoted value whose text is not all on its line", () => {
      const env = envFor(
        writeConfig(
          'allowed_https_rules: "a.example.com:443\\n"\nknown_blocked_rules: "\\\n  t.example.com"\n',
        ),
      );
      expect(applyConfigFile(env, INPUTS)?.origins).toEqual(
        new Map([
          ["allowed_https_rules", { offset: 0 }],
          ["known_blocked_rules", { offset: 0 }],
        ]),
      );
      expect(env.INPUT_KNOWN_BLOCKED_RULES).toBe("t.example.com");
    });

    it("leaves out an input the file's value did not reach, or reached empty", () => {
      const env = envFor(
        writeConfig("proxy_mode: audit\nproxy_engine:\nallowed_https_rules: ''\n"),
        { INPUT_PROXY_MODE: "restrict" },
      );
      expect(applyConfigFile(env, INPUTS)?.origins).toEqual(new Map());
    });
  });

  it("leaves the inputs the workflow set, and names them", () => {
    const env = envFor(writeConfig("proxy_mode: audit\nproxy_engine: universal\n"), {
      INPUT_PROXY_MODE: "restrict",
      INPUT_PROXY_ENGINE: "inspect",
    });
    expect(applyConfigFile(env, INPUTS)?.warning).toBe(
      "Ignored from config_file buildcage.yml, set by the workflow: proxy_mode, proxy_engine",
    );
    expect(env.INPUT_PROXY_MODE).toBe("restrict");
    expect(env.INPUT_PROXY_ENGINE).toBe("inspect");
  });

  it("names no input whose file value is empty or the workflow's", () => {
    const env = envFor(writeConfig("proxy_mode: restrict\nproxy_engine:\n"), {
      INPUT_PROXY_MODE: "restrict",
      INPUT_PROXY_ENGINE: "inspect",
    });
    expect(applyConfigFile(env, INPUTS)?.warning).toBeUndefined();
    expect(env.INPUT_PROXY_MODE).toBe("restrict");
    expect(env.INPUT_PROXY_ENGINE).toBe("inspect");
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
    expect(applyConfigFile(env, INPUTS)?.warning).toBeUndefined();
    expect(env.INPUT_ALLOWED_HTTPS_RULES).toBe(
      "a.example.com:443\nb.example.com:443\nc.example.com:443\n",
    );
  });

  it("takes a list input from the file alone when the workflow has none", () => {
    const env = envFor(writeConfig("known_blocked_rules: t.example.com\n"));
    expect(applyConfigFile(env, INPUTS)?.warning).toBeUndefined();
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
    expect(applyConfigFile(env, INPUTS)?.warning).toBeUndefined();
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
    it("refuses pull_request_target", () => {
      expectError(
        envFor(writeConfig("proxy_mode: audit\n"), { GITHUB_EVENT_NAME: "pull_request_target" }),
        "CONFIG_FILE_UNTRUSTED_EVENT",
        "config_file cannot be used on pull_request_target: the workspace may hold a pull " +
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

    it.each(["pull_request", "pull_request_target", "pull_request_review"])(
      "refuses workflow_run triggered by %s",
      (event) => {
        expectError(
          workflowRun(JSON.stringify({ workflow_run: { event } })),
          "CONFIG_FILE_UNTRUSTED_EVENT",
          new RegExp(`^config_file cannot be used on workflow_run triggered by ${event}: `),
        );
      },
    );

    it.each([
      ["push", JSON.stringify({ workflow_run: { event: "push" } })],
      ["no trigger event", JSON.stringify({ workflow_run: {} })],
      ["a non-string trigger event", JSON.stringify({ workflow_run: { event: 1 } })],
      ["no workflow_run", "{}"],
    ])("allows workflow_run with %s", (_, payload) => {
      const env = workflowRun(payload);
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

    it("allows pull_request", () => {
      const env = envFor(writeConfig("proxy_mode: audit\n"), { GITHUB_EVENT_NAME: "pull_request" });
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
        "with a key that is not a name",
        "proxy_mode: audit\n? [a]\n: x\n",
        /^Invalid config_file "buildcage.yml": unknown key "\[ a \]"/,
      ],
      [
        "with an unknown key",
        "proxy_mod: audit\n",
        'Invalid config_file "buildcage.yml": unknown key "proxy_mod". Allowed keys: ' +
          "proxy_mode, proxy_engine, allowed_https_rules, known_blocked_rules.",
      ],
      [
        "with a << key YAML 1.2 does not merge",
        "proxy_mode: audit\n<<: {proxy_engine: inspect}\n",
        /^Invalid config_file "buildcage.yml": unknown key "<<"/,
      ],
      [
        "with a quoted << key",
        '%YAML 1.1\n---\nproxy_mode: audit\n"<<": x\n',
        /^Invalid config_file "buildcage.yml": unknown key "<<"/,
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

  it("refuses a file whose aliases expand too far", () => {
    const list = (item: string) => `[${Array(10).fill(item).join(", ")}]`;
    expectError(
      envFor(writeConfig(`a: &a ${list("x")}\nb: &b ${list("*a")}\nc: ${list("*b")}\n`)),
      "CONFIG_FILE_INVALID",
      /^Invalid config_file "buildcage.yml": Excessive alias count/,
    );
  });

  it("passes on YAML's warnings, before any error", () => {
    const emitWarning = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    const env = envFor(writeConfig("proxy_mode: !unknown audit\n"));
    applyConfigFile(env, INPUTS);
    expect(env.INPUT_PROXY_MODE).toBe("audit");
    expectError(
      envFor(writeConfig("proxy_engine: !unknown x\nproxy_mode: [\n")),
      "CONFIG_FILE_INVALID",
      /^Invalid config_file "buildcage.yml": /,
    );
    expect(emitWarning).toHaveBeenCalledTimes(2);
    expect(emitWarning).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/^Unresolved tag: !unknown/) }),
    );
  });

  it("changes nothing when the file is refused", () => {
    const env = envFor(writeConfig("proxy_mode: audit\nproxy_mod: x\n"));
    expect(() => applyConfigFile(env, INPUTS)).toThrow(ConfigFileError);
    expect(env.INPUT_PROXY_MODE).toBeUndefined();
  });
});

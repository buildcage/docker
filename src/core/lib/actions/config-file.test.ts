import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyConfigFile, ConfigFileError } from "./config-file.ts";

const INPUTS = {
  known: ["proxy-mode", "proxy-engine", "allowed-https-rules", "known-blocked-rules"],
  lists: ["allowed-https-rules", "known-blocked-rules"],
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
  return { GITHUB_WORKSPACE: workspace, "INPUT_CONFIG-FILE": path, ...extra };
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
  it("does nothing without config-file", () => {
    const env = { "INPUT_PROXY-MODE": "audit" };
    expect(applyConfigFile(env, INPUTS)).toBeUndefined();
    expect(env).toEqual({ "INPUT_PROXY-MODE": "audit" });
  });

  it("fills an input the workflow left unset, and returns the file's path", () => {
    const env = envFor(writeConfig("proxy-mode: audit\n"));
    expect(applyConfigFile(env, INPUTS)).toEqual({
      path: join(workspace, "buildcage.yml"),
      origins: new Map([["proxy-mode", { offset: 0, line: 1 }]]),
    });
    expect(env["INPUT_PROXY-MODE"]).toBe("audit");
  });

  it.each([
    ["before", "%YAML 1.1\n---\n<<: {proxy_mode: audit}\nproxy-mode: restrict\n", 4],
    ["after", "%YAML 1.1\n---\nproxy_mode: restrict\n<<: {proxy-mode: audit}\n", 3],
  ])(
    "takes the map's own key over the other spelling a merge key brought in %s it",
    (_, text, line) => {
      const env = envFor(writeConfig(text));
      expect(applyConfigFile(env, INPUTS)?.origins).toEqual(
        new Map([["proxy-mode", { offset: 0, line }]]),
      );
      expect(env["INPUT_PROXY-MODE"]).toBe("restrict");
    },
  );

  it("refuses an input both merged maps set, one in each spelling", () => {
    expectError(
      envFor(writeConfig("%YAML 1.1\n---\n<<: [{proxy_mode: audit}, {proxy-mode: restrict}]\n")),
      "CONFIG_FILE_INVALID",
      'Invalid config-file "buildcage.yml": proxy-mode is set twice, also as proxy_mode.',
    );
  });

  it("reads a key in an input's underscore spelling as that input", () => {
    const env = envFor(writeConfig("proxy_mode: audit\nknown_blocked_rules: t.example.com\n"), {
      "INPUT_KNOWN-BLOCKED-RULES": "u.example.com",
    });
    expect(applyConfigFile(env, INPUTS)?.origins).toEqual(
      new Map([
        ["proxy-mode", { offset: 0, line: 1 }],
        ["known-blocked-rules", { offset: 1, line: 2 }],
      ]),
    );
    expect(env["INPUT_PROXY-MODE"]).toBe("audit");
    expect(env["INPUT_KNOWN-BLOCKED-RULES"]).toBe("u.example.com\nt.example.com");
    expect(env).not.toHaveProperty("INPUT_PROXY_MODE");
  });

  describe("origins", () => {
    it("places a list input's file lines after the workflow's", () => {
      const env = envFor(
        writeConfig("proxy-mode: audit\nallowed-https-rules: |\n  b.example.com:443\n"),
        { "INPUT_ALLOWED-HTTPS-RULES": "a.example.com:443\n# a comment\n" },
      );
      expect(applyConfigFile(env, INPUTS)?.origins.get("allowed-https-rules")).toEqual({
        offset: 3,
        line: 3,
      });
      expect(env["INPUT_ALLOWED-HTTPS-RULES"]!.split("\n")[3]).toBe("b.example.com:443");
    });

    it("starts a list input at the file's lines when the workflow has none", () => {
      const env = envFor(writeConfig("\nknown-blocked-rules: t.example.com\n"), {
        "INPUT_KNOWN-BLOCKED-RULES": " ",
      });
      expect(applyConfigFile(env, INPUTS)?.origins).toEqual(
        new Map([["known-blocked-rules", { offset: 0, line: 2 }]]),
      );
    });

    it("puts a block's value on the lines after its header", () => {
      const env = envFor(writeConfig("known-blocked-rules: |\n  t.example.com\n"));
      expect(applyConfigFile(env, INPUTS)?.origins.get("known-blocked-rules")).toEqual({
        offset: 0,
        line: 2,
      });
    });

    it("gives no line for a value whose lines YAML may have joined", () => {
      const env = envFor(
        writeConfig(
          'allowed-https-rules: "a.example.com:443\\nb.example.com:443"\n' +
            "known-blocked-rules: >\n  t.example.com\n  u.example.com\n",
        ),
      );
      expect(applyConfigFile(env, INPUTS)?.origins).toEqual(
        new Map([
          ["allowed-https-rules", { offset: 0 }],
          ["known-blocked-rules", { offset: 0 }],
        ]),
      );
      expect(env["INPUT_ALLOWED-HTTPS-RULES"]).toBe("a.example.com:443\nb.example.com:443");
    });

    it("puts an alias's value where its anchor's is", () => {
      const env = envFor(
        writeConfig(
          "allowed-https-rules: &r |\n  a.example.com:443\n  b.example.com:443\n" +
            "known-blocked-rules: *r\n",
        ),
      );
      expect(applyConfigFile(env, INPUTS)?.origins.get("known-blocked-rules")).toEqual({
        offset: 0,
        line: 2,
      });
    });

    it("puts a merged value where its map has it, the map's own and the first merged winning", () => {
      const env = envFor(
        writeConfig(
          "%YAML 1.1\n---\n<<:\n  - &m {proxy-mode: audit}\n" +
            "  - {proxy-mode: restrict, proxy-engine: inspect}\n  - *m\n" +
            "<<: {known-blocked-rules: t.example.com}\nknown-blocked-rules: u.example.com\n",
        ),
      );
      expect(applyConfigFile(env, INPUTS)?.origins).toEqual(
        new Map([
          ["proxy-mode", { offset: 0, line: 4 }],
          ["proxy-engine", { offset: 0, line: 5 }],
          ["known-blocked-rules", { offset: 0, line: 8 }],
        ]),
      );
      expect(env).toMatchObject({
        "INPUT_PROXY-MODE": "audit",
        "INPUT_PROXY-ENGINE": "inspect",
        "INPUT_KNOWN-BLOCKED-RULES": "u.example.com",
      });
    });

    it("finds a value merged as yaml merges it, under a tagged key or from an aliased list", () => {
      const env = envFor(
        writeConfig(
          "%YAML 1.1\n---\n!!str <<: {proxy-mode: audit}\n" +
            "<<: {known-blocked-rules: &s [{proxy-engine: inspect}]}\n" +
            "known-blocked-rules: t.example.com\n<<: *s\n",
        ),
      );
      expect(applyConfigFile(env, INPUTS)?.origins).toEqual(
        new Map([
          ["proxy-mode", { offset: 0, line: 3 }],
          ["known-blocked-rules", { offset: 0, line: 5 }],
          ["proxy-engine", { offset: 0, line: 4 }],
        ]),
      );
    });

    it("finds a value whose key is an alias", () => {
      const env = envFor(writeConfig("proxy-mode: &k proxy-engine\n*k : inspect\n"));
      expect(applyConfigFile(env, INPUTS)?.origins.get("proxy-engine")).toEqual({
        offset: 0,
        line: 2,
      });
      expect(env["INPUT_PROXY-ENGINE"]).toBe("inspect");
    });

    it("gives no line for a quoted value whose text is not all on its line", () => {
      const env = envFor(
        writeConfig(
          'allowed-https-rules: "a.example.com:443\\n"\nknown-blocked-rules: "\\\n  t.example.com"\n',
        ),
      );
      expect(applyConfigFile(env, INPUTS)?.origins).toEqual(
        new Map([
          ["allowed-https-rules", { offset: 0 }],
          ["known-blocked-rules", { offset: 0 }],
        ]),
      );
      expect(env["INPUT_KNOWN-BLOCKED-RULES"]).toBe("t.example.com");
    });

    it("leaves out an input the file's value did not reach, or reached empty", () => {
      const env = envFor(
        writeConfig("proxy-mode: audit\nproxy-engine:\nallowed-https-rules: ''\n"),
        { "INPUT_PROXY-MODE": "restrict" },
      );
      expect(applyConfigFile(env, INPUTS)?.origins).toEqual(new Map());
    });
  });

  it("leaves the inputs the workflow set, and names them", () => {
    const env = envFor(writeConfig("proxy-mode: audit\nproxy-engine: universal\n"), {
      "INPUT_PROXY-MODE": "restrict",
      "INPUT_PROXY-ENGINE": "inspect",
    });
    expect(applyConfigFile(env, INPUTS)?.warning).toBe(
      "Ignored from config-file buildcage.yml, set by the workflow: proxy-mode, proxy-engine",
    );
    expect(env["INPUT_PROXY-MODE"]).toBe("restrict");
    expect(env["INPUT_PROXY-ENGINE"]).toBe("inspect");
  });

  it("names no input whose file value is empty or the workflow's", () => {
    const env = envFor(writeConfig("proxy-mode: restrict\nproxy-engine:\n"), {
      "INPUT_PROXY-MODE": "restrict",
      "INPUT_PROXY-ENGINE": "inspect",
    });
    expect(applyConfigFile(env, INPUTS)?.warning).toBeUndefined();
    expect(env["INPUT_PROXY-MODE"]).toBe("restrict");
    expect(env["INPUT_PROXY-ENGINE"]).toBe("inspect");
  });

  // The runner sets every declared input, an unset one to "".
  it("fills an input the workflow set to empty", () => {
    const env = envFor(writeConfig("proxy-engine: universal\n"), { "INPUT_PROXY-ENGINE": "" });
    applyConfigFile(env, INPUTS);
    expect(env["INPUT_PROXY-ENGINE"]).toBe("universal");
  });

  it("appends a list input to the workflow's", () => {
    const env = envFor(
      writeConfig("allowed-https-rules: |\n  b.example.com:443\n  c.example.com:443\n"),
      { "INPUT_ALLOWED-HTTPS-RULES": "a.example.com:443" },
    );
    expect(applyConfigFile(env, INPUTS)?.warning).toBeUndefined();
    expect(env["INPUT_ALLOWED-HTTPS-RULES"]).toBe(
      "a.example.com:443\nb.example.com:443\nc.example.com:443\n",
    );
  });

  it("takes a list input from the file alone when the workflow has none", () => {
    const env = envFor(writeConfig("known-blocked-rules: t.example.com\n"));
    expect(applyConfigFile(env, INPUTS)?.warning).toBeUndefined();
    expect(env["INPUT_KNOWN-BLOCKED-RULES"]).toBe("t.example.com");
  });

  it("keeps the workflow's list input when the file's is empty", () => {
    const env = envFor(writeConfig("allowed-https-rules:\n"), {
      "INPUT_ALLOWED-HTTPS-RULES": "a.example.com:443",
    });
    applyConfigFile(env, INPUTS);
    expect(env["INPUT_ALLOWED-HTTPS-RULES"]).toBe("a.example.com:443");
  });

  it.each([
    ["true", "true"],
    ["7", "7"],
    ["", ""],
  ])("reads the scalar %o as the input text %o", (yaml, text) => {
    const env = envFor(writeConfig(`proxy-mode: ${yaml}\n`));
    applyConfigFile(env, INPUTS);
    expect(env["INPUT_PROXY-MODE"]).toBe(text);
  });

  it("accepts an empty file", () => {
    const env = envFor(writeConfig(""));
    expect(applyConfigFile(env, INPUTS)?.warning).toBeUndefined();
  });

  it("trims the path", () => {
    const env = envFor(` ${writeConfig("proxy-mode: audit\n")}\n`);
    applyConfigFile(env, INPUTS);
    expect(env["INPUT_PROXY-MODE"]).toBe("audit");
  });

  it("reads a file in a subdirectory", () => {
    mkdirSync(join(workspace, "svc"));
    const env = envFor(writeConfig("proxy-mode: audit\n", "svc/buildcage.yml"));
    applyConfigFile(env, INPUTS);
    expect(env["INPUT_PROXY-MODE"]).toBe("audit");
  });

  it("resolves against a base directory in the workspace", () => {
    mkdirSync(join(workspace, "svc"));
    writeConfig("proxy-mode: audit\n", "shared.yml");
    const env = envFor("../shared.yml");
    applyConfigFile(env, INPUTS, join(workspace, "svc"));
    expect(env["INPUT_PROXY-MODE"]).toBe("audit");
  });

  it("falls back to the working directory without GITHUB_WORKSPACE", () => {
    const cwd = process.cwd();
    process.chdir(workspace);
    try {
      const env = { "INPUT_CONFIG-FILE": writeConfig("proxy-mode: audit\n") };
      applyConfigFile(env, INPUTS);
      expect(env).toHaveProperty("INPUT_PROXY-MODE", "audit");
    } finally {
      process.chdir(cwd);
    }
  });

  describe("on an untrusted event", () => {
    it("refuses pull_request_target", () => {
      expectError(
        envFor(writeConfig("proxy-mode: audit\n"), { GITHUB_EVENT_NAME: "pull_request_target" }),
        "CONFIG_FILE_UNTRUSTED_EVENT",
        "config-file cannot be used on pull_request_target: the workspace may hold a pull " +
          "request's code, which could then rewrite its own rules. Set the inputs in the " +
          "workflow instead.",
      );
    });

    function workflowRun(payload: string): NodeJS.ProcessEnv {
      const eventPath = join(root, "event.json");
      writeFileSync(eventPath, payload);
      return envFor(writeConfig("proxy-mode: audit\n"), {
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
          new RegExp(`^config-file cannot be used on workflow_run triggered by ${event}: `),
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
      expect(env["INPUT_PROXY-MODE"]).toBe("audit");
    });

    it("refuses workflow_run when its payload can't be read", () => {
      expectError(
        envFor(writeConfig("proxy-mode: audit\n"), { GITHUB_EVENT_NAME: "workflow_run" }),
        "CONFIG_FILE_UNTRUSTED_EVENT",
        /^config-file cannot be used: the workflow_run event payload could not be read \(/,
      );
    });

    it("allows pull_request", () => {
      const env = envFor(writeConfig("proxy-mode: audit\n"), { GITHUB_EVENT_NAME: "pull_request" });
      applyConfigFile(env, INPUTS);
      expect(env["INPUT_PROXY-MODE"]).toBe("audit");
    });

    // The inputs alone come from the default branch, so they stay usable.
    it("leaves a run without config-file alone", () => {
      const env = { GITHUB_EVENT_NAME: "pull_request_target", "INPUT_PROXY-MODE": "audit" };
      expect(applyConfigFile(env, INPUTS)).toBeUndefined();
    });
  });

  describe("refuses a path", () => {
    it("that is absolute", () => {
      expectError(
        envFor(join(workspace, writeConfig("proxy-mode: audit\n"))),
        "CONFIG_FILE_PATH",
        `config-file ${JSON.stringify(join(workspace, "buildcage.yml"))} must be a relative path.`,
      );
    });

    it("that does not exist", () => {
      expectError(
        envFor("missing.yml"),
        "CONFIG_FILE_PATH",
        'config-file "missing.yml" was not found. ' +
          "Check out the repository in an earlier step.",
      );
    });

    it("that climbs out of the workspace", () => {
      writeFileSync(join(root, "outside.yml"), "proxy-mode: audit\n");
      expectError(
        envFor("../outside.yml"),
        "CONFIG_FILE_PATH",
        'config-file "../outside.yml" leads outside the workspace.',
      );
    });

    it("that leaves the workspace from a base directory outside it", () => {
      writeFileSync(join(root, "outside.yml"), "proxy-mode: audit\n");
      const env = envFor("outside.yml");
      expect(() => applyConfigFile(env, INPUTS, root)).toThrow(
        'config-file "outside.yml" leads outside the workspace.',
      );
    });

    it("that is the workspace itself", () => {
      expectError(envFor("."), "CONFIG_FILE_PATH", /^config-file "\." could not be read: /);
    });
  });

  describe("symlinks", () => {
    it("follows a symlink that stays in the workspace", () => {
      writeConfig("proxy-mode: audit\n", "real.yml");
      symlinkSync(join(workspace, "real.yml"), join(workspace, "link.yml"));
      const env = envFor("link.yml");
      expect(applyConfigFile(env, INPUTS)?.path).toBe(join(workspace, "real.yml"));
      expect(env["INPUT_PROXY-MODE"]).toBe("audit");
    });

    it("follows a workspace reached through a symlink", () => {
      writeConfig("proxy-mode: audit\n");
      symlinkSync(workspace, join(root, "linked-workspace"));
      const env = {
        GITHUB_WORKSPACE: join(root, "linked-workspace"),
        "INPUT_CONFIG-FILE": "buildcage.yml",
      };
      expect(applyConfigFile(env, INPUTS)?.path).toBe(join(workspace, "buildcage.yml"));
    });

    it("refuses a symlink out of the workspace", () => {
      writeFileSync(join(root, "outside.yml"), "proxy-mode: audit\n");
      symlinkSync(join(root, "outside.yml"), join(workspace, "link.yml"));
      expectError(
        envFor("link.yml"),
        "CONFIG_FILE_PATH",
        'config-file "link.yml" leads outside the workspace.',
      );
    });
  });

  describe("refuses a file", () => {
    it.each([
      ["that is not YAML", "proxy-mode: [\n", /^Invalid config-file "buildcage.yml": /],
      [
        "with a duplicate key",
        "proxy-mode: audit\nproxy-mode: restrict\n",
        /^Invalid config-file "buildcage.yml": Map keys must be unique/,
      ],
      [
        "setting an input in both spellings",
        "proxy-mode: audit\nproxy_mode: audit\n",
        'Invalid config-file "buildcage.yml": proxy-mode is set twice, also as proxy_mode.',
      ],
      [
        "with a key mixing the two spellings",
        "proxy-mode: audit\nallowed_https-rules: a.example.com:443\n",
        'Invalid config-file "buildcage.yml": unknown key "allowed_https-rules". Allowed keys: proxy-mode, proxy-engine, allowed-https-rules, known-blocked-rules.',
      ],
      [
        "whose top level is a list",
        "- proxy-mode\n",
        'Invalid config-file "buildcage.yml": the top level must be a mapping of input names to values.',
      ],
      [
        "whose top level is a string",
        "proxy-mode\n",
        'Invalid config-file "buildcage.yml": the top level must be a mapping of input names to values.',
      ],
      [
        "with a key that is not a name",
        "proxy-mode: audit\n? [a]\n: x\n",
        /^Invalid config-file "buildcage.yml": unknown key "\[ a \]"/,
      ],
      [
        "with an unknown key",
        "proxy_mod: audit\n",
        'Invalid config-file "buildcage.yml": unknown key "proxy_mod". Allowed keys: ' +
          "proxy-mode, proxy-engine, allowed-https-rules, known-blocked-rules.",
      ],
      [
        "with a << key YAML 1.2 does not merge",
        "proxy-mode: audit\n<<: {proxy-engine: inspect}\n",
        /^Invalid config-file "buildcage.yml": unknown key "<<"/,
      ],
      [
        "with a quoted << key",
        '%YAML 1.1\n---\nproxy-mode: audit\n"<<": x\n',
        /^Invalid config-file "buildcage.yml": unknown key "<<"/,
      ],
      [
        "with a list value",
        "allowed-https-rules:\n  - a.example.com:443\n",
        'Invalid config-file "buildcage.yml": allowed-https-rules must be a string, as it would be in the workflow.',
      ],
      [
        "with a mapping value",
        "proxy-mode:\n  value: audit\n",
        'Invalid config-file "buildcage.yml": proxy-mode must be a string, as it would be in the workflow.',
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
      /^Invalid config-file "buildcage.yml": Excessive alias count/,
    );
  });

  it("passes on YAML's warnings, before any error", () => {
    const emitWarning = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    const env = envFor(writeConfig("proxy-mode: !unknown audit\n"));
    applyConfigFile(env, INPUTS);
    expect(env["INPUT_PROXY-MODE"]).toBe("audit");
    expectError(
      envFor(writeConfig("proxy-engine: !unknown x\nproxy-mode: [\n")),
      "CONFIG_FILE_INVALID",
      /^Invalid config-file "buildcage.yml": /,
    );
    expect(emitWarning).toHaveBeenCalledTimes(2);
    expect(emitWarning).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/^Unresolved tag: !unknown/) }),
    );
  });

  it("changes nothing when the file is refused", () => {
    const env = envFor(writeConfig("proxy-mode: audit\nproxy_mod: x\n"));
    expect(() => applyConfigFile(env, INPUTS)).toThrow(ConfigFileError);
    expect(env["INPUT_PROXY-MODE"]).toBeUndefined();
  });
});

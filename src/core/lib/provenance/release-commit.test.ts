import { describe, it, expect } from "vitest";

import { expectVerifyError } from "#core/lib/test/registry-stub.ts";

import {
  resolveReleaseCommit,
  type ReleaseCommitLookup,
  type RunGit,
  type RunGitOptions,
} from "./release-commit.ts";

const COMMIT = "c".repeat(40);
const TAG_OBJECT = "d".repeat(40);
const REF = "refs/tags/v2.1.0";

const LOOKUP: ReleaseCommitLookup = { actionRepo: "owner/repo", actionVersion: "2.1.0" };

/** Answers every call with `answer`: stdout, or a function that throws. */
function stubGit(answer: string | (() => never)) {
  const calls: { args: string[]; options: RunGitOptions }[] = [];
  const runGit: RunGit = async (args, options) => {
    calls.push({ args, options });
    return typeof answer === "string" ? answer : answer();
  };
  return { runGit, calls };
}

function resolve(
  answer: string | (() => never),
  lookup: Partial<ReleaseCommitLookup> = {},
  env: NodeJS.ProcessEnv = { PATH: "/usr/bin" },
) {
  const stub = stubGit(answer);
  return { stub, result: resolveReleaseCommit({ ...LOOKUP, ...lookup }, stub.runGit, env) };
}

const lines = (...refs: [string, string][]) =>
  refs.map(([sha, ref]) => `${sha}\t${ref}\n`).join("");

const fails = (error: object) => (): never => {
  throw Object.assign(new Error("Command failed: git ls-remote"), error);
};

describe("resolveReleaseCommit", () => {
  it("returns the commit of a lightweight tag", async () => {
    const { stub, result } = resolve(lines([COMMIT, REF]));
    await expect(result).resolves.toBe(COMMIT);
    expect(stub.calls.map((c) => c.args)).toEqual([
      ["ls-remote", "https://github.com/owner/repo.git", REF, `${REF}^{}`],
    ]);
  });

  it("runs git outside any checkout with nothing from the job but PATH", async () => {
    const env = { PATH: "/bin", HOME: "/home/runner", GIT_ASKPASS: "/x", GITHUB_TOKEN: "tok" };
    const { stub, result } = resolve(lines([COMMIT, REF]), {}, env);
    await result;
    expect(stub.calls[0]!.options).toEqual({
      cwd: "/",
      env: {
        PATH: "/bin",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    const { stub: noPath, result: again } = resolve(lines([COMMIT, REF]), {}, {});
    await again;
    expect(noPath.calls[0]!.options.env.PATH).toBe("");
  });

  it("follows an annotated tag to the commit git peels it to", async () => {
    for (const output of [
      lines([TAG_OBJECT, REF], [COMMIT, `${REF}^{}`]),
      lines([COMMIT, `${REF}^{}`], [TAG_OBJECT, REF]),
    ]) {
      await expect(resolve(output).result).resolves.toBe(COMMIT);
    }
  });

  it("reads only the tag asked for", async () => {
    const other = "e".repeat(40);
    const output = lines([other, `refs/heads/${REF}`], [other, "refs/tags/v2.1.0.1"]);
    await expectVerifyError(
      resolve(output).result,
      "NOT_FOUND",
      "Found no tag v2.1.0 in owner/repo",
    );
    await expectVerifyError(resolve("").result, "NOT_FOUND", "Found no tag v2.1.0");
  });

  it("refuses a malformed object SHA", async () => {
    for (const sha of ["C".repeat(40), "c".repeat(64), ""]) {
      await expectVerifyError(
        resolve(lines([sha, REF])).result,
        "VERIFY_FAILED",
        "Malformed object SHA for tag v2.1.0",
      );
    }
  });

  it("names a missing git", async () => {
    await expectVerifyError(
      resolve(fails({ code: "ENOENT" })).result,
      "VERIFY_FAILED",
      "git is not on PATH",
    );
  });

  it("reads GitHub's request for credentials as a repository it will not show", async () => {
    const stderr =
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled\n";
    await expectVerifyError(
      resolve(fails({ code: 128, stderr })).result,
      "NOT_FOUND",
      "Found no public repository owner/repo.",
    );
  });

  it("reads any other failure as TRANSIENT", async () => {
    const stderr = "warning: x\nfatal: unable to access 'https://github.com/owner/repo.git/'\n";
    await expectVerifyError(
      resolve(fails({ code: 128, stderr })).result,
      "TRANSIENT",
      /owner\/repo: fatal: unable to access 'https:\/\/github\.com\/owner\/repo\.git\/'$/,
    );
    await expectVerifyError(
      resolve(fails({ killed: true, signal: "SIGTERM", stderr: "" })).result,
      "TRANSIENT",
      "git ls-remote timed out",
    );
    await expectVerifyError(
      resolve(fails({ code: 1, stderr: "" })).result,
      "TRANSIENT",
      "Command failed: git ls-remote",
    );
    await expectVerifyError(
      resolve(fails({ code: "EACCES" })).result,
      "TRANSIENT",
      "owner/repo: Command failed: git ls-remote",
    );
  });

  it("refuses a malformed repository before running git", async () => {
    for (const actionRepo of ["", "owner", "owner/repo/x", "owner/re po", "../x/y"]) {
      const { stub, result } = resolve(lines([COMMIT, REF]), { actionRepo });
      await expectVerifyError(result, "VERIFY_FAILED", "Malformed action repository");
      expect(stub.calls).toEqual([]);
    }
  });
});

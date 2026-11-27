/**
 * Resolves the commit of this build's release tag with `git ls-remote`, which
 * reads the public repository without a token.
 *
 * All errors are thrown as VerifyImageError (see errors.ts).
 */

import { execFile } from "node:child_process";

import { errorMessage } from "../errors.ts";
import { VerifyImageError } from "./errors.ts";

const GITHUB = "https://github.com";

const REPO_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/;

const LS_REMOTE_TIMEOUT_MS = 60_000;

export interface ReleaseCommitLookup {
  actionRepo: string;
  actionVersion: string;
}

export interface RunGitOptions {
  env: NodeJS.ProcessEnv;
  cwd: string;
}

/** Runs `git <args>` and resolves to its stdout; rejects with execFile's error and the stderr. */
export type RunGit = (args: string[], options: RunGitOptions) => Promise<string>;

// Untested by design: hands node:child_process what the tested caller decided.
/* v8 ignore start */
const runGit: RunGit = (args, { env, cwd }) =>
  new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { env, cwd, encoding: "utf8", timeout: LS_REMOTE_TIMEOUT_MS },
      (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve(stdout)),
    );
  });
/* v8 ignore stop */

/**
 * Nothing from the job but PATH, so no config, credential helper or prompt can
 * attach the job's token to the request.
 */
function gitEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    PATH: env.PATH ?? "",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
  };
}

function lsRemoteError(e: unknown, actionRepo: string): VerifyImageError {
  const { code, killed, stderr } = Object(e) as {
    code?: unknown;
    killed?: boolean;
    stderr?: unknown;
  };
  if (code === "ENOENT") {
    return new VerifyImageError(
      "git is not on PATH; the action needs it to read its release tag.",
      "VERIFY_FAILED",
    );
  }
  const detail = typeof stderr === "string" ? stderr.trim().split("\n").at(-1) : undefined;
  // GitHub asks for credentials, rather than saying so, for a repository it will not show.
  if (detail?.includes("could not read Username")) {
    return new VerifyImageError(`Found no public repository ${actionRepo}.`, "NOT_FOUND");
  }
  return new VerifyImageError(
    `Transient error reading the tags of ${actionRepo}: ` +
      (killed ? "git ls-remote timed out" : detail || errorMessage(e)),
    "TRANSIENT",
  );
}

/**
 * Return the commit of tag `v<actionVersion>`.
 *
 * An annotated tag's commit is on the line git peels it to (`^{}`). A tag
 * pointing at anything but a commit is returned as is and matches no image.
 */
export async function resolveReleaseCommit(
  { actionRepo, actionVersion }: ReleaseCommitLookup,
  _runGit: RunGit = runGit,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  if (!REPO_NAME.test(actionRepo)) {
    throw new VerifyImageError(
      `Malformed action repository: ${JSON.stringify(actionRepo)}`,
      "VERIFY_FAILED",
    );
  }
  const tag = `v${actionVersion}`;
  const ref = `refs/tags/${tag}`;
  let output: string;
  try {
    // Outside any checkout: a workspace's .git/config can carry the job's token for github.com.
    output = await _runGit(["ls-remote", `${GITHUB}/${actionRepo}.git`, ref, `${ref}^{}`], {
      env: gitEnv(env),
      cwd: "/",
    });
  } catch (e) {
    throw lsRemoteError(e, actionRepo);
  }

  const refs = new Map<string, string>();
  for (const line of output.split("\n")) {
    const [sha, name] = line.split("\t");
    if (name !== undefined) refs.set(name, sha!);
  }
  const sha = refs.get(`${ref}^{}`) ?? refs.get(ref);
  if (sha === undefined) {
    throw new VerifyImageError(`Found no tag ${tag} in ${actionRepo}.`, "NOT_FOUND");
  }
  if (!COMMIT_SHA.test(sha)) {
    throw new VerifyImageError(
      `Malformed object SHA for tag ${tag}: ${JSON.stringify(sha)}`,
      "VERIFY_FAILED",
    );
  }
  return sha;
}

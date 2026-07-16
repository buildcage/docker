import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// Not import.meta.dirname: rollup's cjs output doesn't understand that
// (newer, Node 20.11+-only) property and silently substitutes `undefined`
// for it — dirname(fileURLToPath(import.meta.url)) is what setup/src/main.js
// uses for the same reason, and it survives the rollup->cjs conversion.
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Write the user-supplied `run:` input to an executable script file.
 * Routing through a file (rather than passing the command inline to a
 * shell) avoids any shell-injection surface from the input string.
 */
export function writeRunScript(runInput, dir) {
  const scriptPath = join(dir, "run-script.sh");
  const content = runInput.startsWith("#!") ? runInput : `#!/bin/sh\nset -e\n${runInput}\n`;
  writeFileSync(scriptPath, content, { mode: 0o700 });
  return scriptPath;
}

/**
 * Dump the current process environment to a NUL-separated KEY=VALUE file,
 * for run-isolated.sh to re-apply inside the isolated namespace via
 * `env -i`. sudo resets the environment by default (env_reset) and we
 * deliberately don't use `sudo -E` (its availability depends on a sudoers
 * SETENV tag, which isn't portable) — this file is the explicit channel
 * instead.
 */
export function writeEnvDump(env, dir) {
  const envFilePath = join(dir, "env-dump.bin");
  const buf = Buffer.concat(
    Object.entries(env)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => Buffer.from(`${k}=${v}\0`, "utf8")),
  );
  writeFileSync(envFilePath, buf);
  return envFilePath;
}

/**
 * Run the user's command inside the isolated sandbox via run-isolated.sh
 * (invoked with `sudo -n`, since setting up the namespaces/veth/iptables
 * requires root). Returns the exit code of the isolated command — never
 * throws for a non-zero exit, since that's the user's command failing,
 * not this function.
 */
export function runIsolated({ scriptPath, proxyPid, workdir, env, runScriptDir }) {
  const runIsolatedShPath = join(__dirname, "..", "scripts", "run-isolated.sh");
  const envFilePath = writeEnvDump(env, runScriptDir);

  const args = [
    "-n",
    "--",
    runIsolatedShPath,
    "--proxy-pid",
    String(proxyPid),
    "--uid",
    String(process.getuid()),
    "--gid",
    String(process.getgid()),
    "--env-file",
    envFilePath,
  ];
  if (workdir) args.push("--workdir", workdir);
  args.push("--", scriptPath);

  try {
    execFileSync("sudo", args, { stdio: "inherit" });
    return 0;
  } catch (e) {
    // A non-zero exit from the isolated command (or run-isolated.sh itself)
    // surfaces here as an ExecException; e.status is the actual exit code.
    // e.status is null if the process was killed by a signal.
    return typeof e.status === "number" ? e.status : 1;
  }
}

/** Create/remove a scratch directory for this step's run-script + env-dump. */
export function withScratchDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "buildcage-sandbox-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

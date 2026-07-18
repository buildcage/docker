/**
 * Runs every *.test.js file found (non-recursively) in each given
 * directory, in a single qjs process — qjs itself only accepts one file
 * argument, so this replaces invoking qjs once per test file.
 *
 * Usage: qjs -m run-tests.js <dir> [<dir> ...]
 */
import * as std from "std";
import * as os from "os";

const dirs = scriptArgs.slice(1);
if (dirs.length === 0) {
  std.err.puts("usage: qjs -m run-tests.js <dir> [<dir> ...]\n");
  std.exit(1);
}

for (const dir of dirs) {
  const [entries, err] = os.readdir(dir);
  if (err) {
    std.err.puts(`cannot read directory ${dir}: errno ${err}\n`);
    std.exit(1);
  }
  // *.property.test.js files are node:test-based (run via `node --test`,
  // not qjs) and live alongside these — exclude them explicitly.
  const testFiles = entries
    .filter((f) => f.endsWith(".test.js") && !f.endsWith(".property.test.js"))
    .sort();
  for (const f of testFiles) {
    await import(`${dir}/${f}`);
  }
}

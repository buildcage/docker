/**
 * Runs every *.test.js file found (non-recursively) in each given
 * directory, in a single qjs process — qjs itself only accepts one file
 * argument, so this replaces invoking qjs once per test file.
 *
 * Usage: qjs --std -m run-tests.qjs.js <dir> [<dir> ...]
 */
import * as std from "qjs:std";
import * as os from "qjs:os";

const dirs = scriptArgs.slice(1);
if (dirs.length === 0) {
  std.err.puts("usage: qjs --std -m run-tests.qjs.js <dir> [<dir> ...]\n");
  std.exit(1);
}

for (const dir of dirs) {
  const [entries, err] = os.readdir(dir);
  if (err) {
    std.err.puts(`cannot read directory ${dir}: errno ${err}\n`);
    std.exit(1);
  }
  const testFiles = entries.filter((f) => f.endsWith(".test.js")).sort();
  for (const f of testFiles) {
    await import(`${dir}/${f}`);
  }
}

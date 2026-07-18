/**
 * Minimal test runner shim for QuickJS.
 * Provides describe/it/assert compatible with the test files.
 */
import * as std from "std";

let passed = 0;
let failed = 0;
let currentSuite = "";

export function describe(name, fn) {
  currentSuite = name;
  fn();
}

export function it(name, fn) {
  const label = `${currentSuite} > ${name}`;
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    std.err.puts(`FAIL: ${label}\n  ${e.message || e}\n`);
  }
}

export const assert = {
  equal(actual, expected) {
    if (actual !== expected) {
      throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  },
  deepEqual(actual, expected) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) {
      throw new Error(`Expected ${b}, got ${a}`);
    }
  },
  ok(value) {
    if (!value) {
      throw new Error(`Expected truthy value, got ${JSON.stringify(value)}`);
    }
  },
  throws(fn, pattern) {
    try {
      fn();
      throw new Error("Expected function to throw");
    } catch (e) {
      if (e.message === "Expected function to throw") throw e;
      if (pattern && !pattern.test(e.message)) {
        throw new Error(`Expected error matching ${pattern}, got "${e.message}"`);
      }
    }
  },
  match(value, pattern) {
    if (!pattern.test(value)) {
      throw new Error(`Expected "${value}" to match ${pattern}`);
    }
  },
};

export function reportResults() {
  std.out.puts(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  const hadFailures = failed > 0;
  // Reset so a runner that imports several *.test.js files into one qjs
  // process (see run-tests.js) gets an accurate per-file count instead of a
  // running total — this module is a singleton across those imports.
  passed = 0;
  failed = 0;
  if (hadFailures) std.exit(1);
}

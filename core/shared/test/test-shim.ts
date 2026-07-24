/**
 * Minimal test runner shim for QuickJS.
 * Provides describe/it/assert compatible with the test files.
 */
import * as std from "qjs:std";

let passed = 0;
let failed = 0;
let currentSuite = "";

export function describe(name: string, fn: () => void): void {
  currentSuite = name;
  fn();
}

export function it(name: string, fn: () => void): void {
  const label = `${currentSuite} > ${name}`;
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    std.err.puts(`FAIL: ${label}\n  ${(e as Error).message || e}\n`);
  }
}

export const assert = {
  equal(actual: unknown, expected: unknown): void {
    if (actual !== expected) {
      throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  },
  deepEqual(actual: unknown, expected: unknown): void {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) {
      throw new Error(`Expected ${b}, got ${a}`);
    }
  },
  ok(value: unknown): void {
    if (!value) {
      throw new Error(`Expected truthy value, got ${JSON.stringify(value)}`);
    }
  },
  throws(fn: () => void, pattern?: RegExp): void {
    try {
      fn();
      throw new Error("Expected function to throw");
    } catch (e) {
      if ((e as Error).message === "Expected function to throw") throw e;
      if (pattern && !pattern.test((e as Error).message)) {
        throw new Error(`Expected error matching ${pattern}, got "${(e as Error).message}"`);
      }
    }
  },
  match(value: string, pattern: RegExp): void {
    if (!pattern.test(value)) {
      throw new Error(`Expected "${value}" to match ${pattern}`);
    }
  },
};

export function reportResults(): void {
  std.out.puts(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  const hadFailures = failed > 0;
  // Reset so a runner that imports several *.test.js files into one qjs
  // process (see run-tests.js) gets an accurate per-file count instead of a
  // running total — this module is a singleton across those imports.
  passed = 0;
  failed = 0;
  if (hadFailures) std.exit(1);
}

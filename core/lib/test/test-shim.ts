/**
 * Test shim, portable between Node (delegates to node:test/node:assert) and
 * QuickJS (its own minimal implementation — node:test and fast-check aren't
 * available there). The same *.test.ts source runs unmodified under both.
 *
 * Module specifiers below are routed through non-literal string variables:
 * tsc only tries to resolve a dynamic import()'s module types when the
 * argument is a string *literal*, so this lets the same file type-check
 * under tsconfig.json (Node types, no qjs ambient types) and
 * tsconfig.qjs.json (qjs ambient types, no Node types) without either
 * config needing to know about the other runtime's modules.
 */
const isNode = typeof (globalThis as { process?: unknown }).process !== "undefined";

interface Assert {
  equal(actual: unknown, expected: unknown): void;
  deepEqual(actual: unknown, expected: unknown): void;
  ok(value: unknown): void;
  throws(fn: () => void, pattern?: RegExp): void;
  match(value: string, pattern: RegExp): void;
  /** Node-only in practice; the QuickJS shim implements it just to satisfy this type. */
  rejects(promise: Promise<unknown>, matcher?: (e: unknown) => boolean): Promise<void>;
}

interface Shim {
  describe(name: string, fn: () => void): void;
  it(name: string, fn: () => void): void;
  assert: Assert;
  reportResults(): void;
}

async function createNodeShim(): Promise<Shim> {
  const nodeTestSpecifier = "node:test";
  const nodeAssertSpecifier = "node:assert/strict";
  const { describe, it } = await import(nodeTestSpecifier);
  const { default: assert } = await import(nodeAssertSpecifier);
  // node:test tracks pass/fail and sets the process exit code itself.
  return { describe, it, assert, reportResults() {} };
}

async function createQjsShim(): Promise<Shim> {
  const qjsStdSpecifier = "qjs:std";
  const std = await import(qjsStdSpecifier);

  let passed = 0;
  let failed = 0;
  let currentSuite = "";

  function describe(name: string, fn: () => void): void {
    currentSuite = name;
    fn();
  }

  function it(name: string, fn: () => void): void {
    const label = `${currentSuite} > ${name}`;
    try {
      fn();
      passed++;
    } catch (e) {
      failed++;
      std.err.puts(`FAIL: ${label}\n  ${(e as Error).message || e}\n`);
    }
  }

  const assert: Assert = {
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
        if ((e as Error).message === "Expected function to throw") throw e;
        if (pattern && !pattern.test((e as Error).message)) {
          throw new Error(`Expected error matching ${pattern}, got "${(e as Error).message}"`);
        }
      }
    },
    match(value, pattern) {
      if (!pattern.test(value)) {
        throw new Error(`Expected "${value}" to match ${pattern}`);
      }
    },
    async rejects(promise, matcher) {
      try {
        await promise;
      } catch (e) {
        if (matcher && !matcher(e)) {
          throw new Error("Rejection did not match the expected condition");
        }
        return;
      }
      throw new Error("Expected promise to reject");
    },
  };

  function reportResults(): void {
    std.out.puts(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
    const hadFailures = failed > 0;
    // Reset so a runner that imports several *.test.js files into one qjs
    // process (see run-tests.qjs.js) gets an accurate per-file count instead of a
    // running total — this module is a singleton across those imports.
    passed = 0;
    failed = 0;
    if (hadFailures) std.exit(1);
  }

  return { describe, it, assert, reportResults };
}

const shim = isNode ? await createNodeShim() : await createQjsShim();

export const { describe, it, assert, reportResults } = shim;

/**
 * Test shim, portable between Node (delegates to vitest) and QuickJS (its
 * own minimal implementation). The same *.test.ts source runs under both.
 *
 * `vitest`/`node:assert/strict`/`qjs:std` are dynamic-imported via non-literal
 * variables so tsc doesn't resolve the other runtime's types. `chai`/
 * `@vitest/expect` are portable, so they're static imports instead — that's
 * also required for bundling, since qjs can't resolve a bare specifier left
 * un-inlined by a dynamic import. The polyfill import must come first: ES
 * modules evaluate static imports before their own body runs.
 */
import "./qjs-event-polyfill.ts";
import * as chai from "chai";
import { JestChaiExpect } from "@vitest/expect";

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

/** Deliberately narrow subset of vitest's real `expect()` chain — only the
 *  matchers this codebase's tests actually use. */
interface ExpectMatchers {
  toBe(expected: unknown): void;
  toStrictEqual(expected: unknown): void;
  toBeTruthy(): void;
  toThrow(pattern?: RegExp | string): void;
}
type Expect = (actual: unknown) => ExpectMatchers;

interface Shim {
  describe(this: void, name: string, fn: () => void): void;
  it(this: void, name: string, fn: () => void): void;
  assert: Assert;
  expect: Expect;
  reportResults(this: void): void;
}

async function createNodeShim(): Promise<Shim> {
  const testRunnerSpecifier = "vitest";
  const nodeAssertSpecifier = "node:assert/strict";
  const { describe, it, expect } = await import(testRunnerSpecifier);
  const { default: assert } = await import(nodeAssertSpecifier);
  // vitest tracks pass/fail and sets the process exit code itself.
  return { describe, it, assert, expect, reportResults() {} };
}

async function createQjsShim(): Promise<Shim> {
  const qjsStdSpecifier = "qjs:std";
  const std = await import(qjsStdSpecifier);

  // The same matcher plugin vitest itself uses on Node, applied directly here.
  chai.use(JestChaiExpect);
  const expect = chai.expect as unknown as Expect;

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
      std.err.puts(`FAIL: ${label}\n  ${e instanceof Error ? e.message : String(e)}\n`);
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
    // Reset for an accurate per-file count when a runner loads multiple
    // *.test.js files into one qjs process (this module is a singleton).
    passed = 0;
    failed = 0;
    if (hadFailures) std.exit(1);
  }

  return { describe, it, assert, expect, reportResults };
}

const shim = isNode ? await createNodeShim() : await createQjsShim();

export const { describe, it, assert, expect, reportResults } = shim;

/**
 * Test shim, portable between Node (delegates to vitest) and QuickJS (its
 * own minimal implementation). The same *.test.ts source runs under both.
 *
 * `vitest`/`qjs:std` are dynamic-imported via non-literal variables so tsc
 * doesn't resolve the other runtime's types. `chai`/`@vitest/expect` are
 * portable, so they're static imports instead — that's also required for
 * bundling, since qjs can't resolve a bare specifier left un-inlined by a
 * dynamic import. The polyfill import must come first: ES modules evaluate
 * static imports before their own body runs.
 */
import "./qjs-event-polyfill.ts";
import * as chai from "chai";
import { JestChaiExpect } from "@vitest/expect";

const isNode = typeof (globalThis as { process?: unknown }).process !== "undefined";

/** Deliberately narrow subset of vitest's real `expect()` chain — only the
 *  matchers this codebase's tests actually use. */
interface ExpectMatchers {
  toBe(expected: unknown): void;
  toStrictEqual(expected: unknown): void;
  toBeTruthy(): void;
  toThrow(pattern?: RegExp | string): void;
  toMatch(pattern: RegExp | string): void;
  toSatisfy(predicate: (value: unknown) => boolean): void;
  not: ExpectMatchers;
  rejects: AsyncExpectMatchers;
}

/** `expect(promise).rejects.toX(...)` — same matchers, each resolving once the promise settles. */
interface AsyncExpectMatchers {
  toBe(expected: unknown): Promise<void>;
  toStrictEqual(expected: unknown): Promise<void>;
  toBeTruthy(): Promise<void>;
  toThrow(pattern?: RegExp | string): Promise<void>;
  toMatch(pattern: RegExp | string): Promise<void>;
  toSatisfy(predicate: (value: unknown) => boolean): Promise<void>;
}
type Expect = (actual: unknown) => ExpectMatchers;

interface Shim {
  describe(this: void, name: string, fn: () => void): void;
  it(this: void, name: string, fn: () => void): void;
  expect: Expect;
  reportResults(this: void): void;
}

async function createNodeShim(): Promise<Shim> {
  const testRunnerSpecifier = "vitest";
  const { describe, it, expect } = await import(testRunnerSpecifier);
  // vitest tracks pass/fail and sets the process exit code itself.
  return { describe, it, expect, reportResults() {} };
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

  function reportResults(): void {
    std.out.puts(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
    const hadFailures = failed > 0;
    // Reset for an accurate per-file count when a runner loads multiple
    // *.test.js files into one qjs process (this module is a singleton).
    passed = 0;
    failed = 0;
    if (hadFailures) std.exit(1);
  }

  return { describe, it, expect, reportResults };
}

const shim = isNode ? await createNodeShim() : await createQjsShim();

export const { describe, it, expect, reportResults } = shim;

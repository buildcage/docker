/**
 * Ambient globals for the QuickJS runtime (quickjs-ng, Alpine 3.24's
 * `quickjs-ng` package) that these scripts run under via `qjs --std -m`.
 *
 * Verified directly against the actual `quickjs-ng` 0.11.0 Alpine package
 * (docker run alpine:3.24.1 + apk add quickjs-ng): the CLI's `--std` flag is
 * required to expose these modules at all, and — unlike Bellard's original
 * QuickJS — the import specifiers are namespaced as "qjs:std"/"qjs:os", not
 * bare "std"/"os" (bare specifiers fail with "could not load module
 * filename 'std'" even with --std passed).
 *
 * Covers only the APIs this codebase actually calls (verified by grep across
 * core/scripts, core/lib, setup/docker/explicit/scripts) — not a general
 * QuickJS type definition. This file must only ever be visible to
 * tsconfig.qjs.json's program (see its "types": []) — @types/node also
 * declares a module named "os", with an incompatible shape, and the two
 * would collide if this file were ever included alongside it.
 */

declare module "qjs:std" {
  // "in" is a reserved word, so it can't be declared directly as an export
  // binding — export-and-rename around it instead.
  const in_: { readAsString(): string };
  export { in_ as in };

  export const out: { puts(s: string): void };
  export const err: { puts(s: string): void };

  export function exit(code: number): never;

  export function open(
    path: string,
    mode: string,
  ): { readAsString(): string; close(): void } | null;

  export function getenv(name: string): string | undefined;
}

declare module "qjs:os" {
  // Second element is an errno-style number, 0 on success.
  export function readdir(path: string): [string[], number];

  // Subprocess execution (explicit engine's report.js shells out to
  // buildctl itself) — verified against the same quickjs-ng 0.11.0 Alpine
  // package: os.exec() with block:false and a pipe fd as stdout, drained
  // via os.read() in a loop, then os.waitpid() to reap the child.
  export function pipe(): [number, number];

  export interface ExecOptions {
    stdout?: number;
    stderr?: number;
    stdin?: number;
    block?: boolean;
    cwd?: string;
  }

  export function exec(args: string[], options?: ExecOptions): number;

  export function close(fd: number): number;

  export function read(fd: number, buffer: ArrayBuffer, offset: number, length: number): number;

  export function waitpid(pid: number, options: number): [number, number];
}

/** qjs's argv equivalent: [scriptPath, ...args]. */
declare const scriptArgs: string[];

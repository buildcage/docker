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
 * core/scripts, core/shared, setup/docker/explicit/scripts) — not a general
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
}

/** qjs's argv equivalent: [scriptPath, ...args]. */
declare const scriptArgs: string[];

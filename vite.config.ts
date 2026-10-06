import { defineConfig } from "vite-plus";

// Committed build artifacts (verified against source by the "Check dist is
// up to date" CI step); never lint or format generated output.
const generatedOutputs = ["dist/**", "report/dist/**"];

// Recorded/golden fixtures: some (e.g. core/lib/log/__fixtures__/*.json) are
// parsed line-by-line to mimic buildctl's real NDJSON-ish log output, so
// pretty-printing them breaks that line structure and fails the tests that
// read them. Fixtures are captured data, not authored code: never reformat
// any of them, even ones that happen to be safe today.
const fixtures = ["**/__fixtures__/**"];

// Vendored third-party code, reviewed as a diff against upstream: the seccomp
// profile pulled from moby/profiles by `make seccomp_profile`, and
// buildcage-runc's Go module vendor tree (`go mod vendor`). Reformatting either
// would destroy that diff.
const vendored = ["docker/seccomp/builder.json", "docker/inspect/buildcage-runc/vendor/**"];

// Allowed to name the always-on `annotate`; everything else takes the sink as an argument
// (see src/core/lib/actions/annotation.ts).
const annotateCallers = [
  "src/lib/setup-step.ts",
  "report/src/lib/report-step.ts",
  "src/core/lib/actions/fatal.ts",
  "src/core/lib/actions/annotation.test.ts",
];

export default defineConfig({
  lint: {
    ignorePatterns: generatedOutputs,
    rules: {
      // A regex, not a group glob: a glob matches the specifier as written, so it would
      // miss the relative "./annotation.ts" that fatal.ts imports through.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "annotation\\.ts$",
              importNames: ["annotate"],
              message: "Take an Annotation, or the annotate method, as an argument instead.",
            },
          ],
        },
      ],
    },
    overrides: [{ files: annotateCallers, rules: { "no-restricted-imports": "off" } }],
    options: {
      // typescript is already at v7 (typescript-go), so tsgolint's type-aware
      // rules apply directly. `vp run typecheck` (tsc) stays the authoritative
      // full type check; typeCheck (still experimental) is left off here.
      typeAware: true,
    },
  },
  fmt: {
    sortImports: true,
    ignorePatterns: [...generatedOutputs, ...fixtures, ...vendored, "MAINTAINERS.md"],
  },
  staged: {
    "*.{ts,tsx,js,jsx,json,jsonc,yaml,yml,md}": "vp check --fix",
    "{dist,report/dist}/**/*.cjs": "sh .github/actions/verify-dist/check-test-hooks.sh",
    "docker/inspect/buildcage-runc/**/*.go": "gofmt -w",
    "test/covfilter/**/*.go": "gofmt -w",
  },
  test: {
    include: ["src/**/*.test.ts", "report/src/**/*.test.ts"],
    restoreMocks: true,
    // @vitest/coverage-v8 is pinned to the exact vitest version vite-plus
    // bundles, which vite-plus asserts at startup; bump both together.
    coverage: {
      provider: "v8",
      // Without an explicit include, v8 reports only files some test imported,
      // which hides the files that have no test at all.
      include: ["src/**/*.ts", "report/src/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        ...fixtures,
        "**/*.d.ts",
        // Test scaffolding: the QuickJS shims and the QuickJS test runner.
        "src/core/lib/test/**",
        "src/core/scripts/test/**",
        // QuickJS entry points, which vitest cannot run. What they call is
        // measured where it lives.
        "**/*.qjs.ts",
      ],
      // text goes to the CI log; the file copy is what the workflow pastes
      // into the job summary.
      reporter: [
        ["text", {}],
        ["text-summary", { file: "summary.txt" }],
      ],
      // 100% is what makes new untested code fail the run. What is
      // deliberately untested carries a v8 ignore comment naming the reason.
      thresholds: { 100: true },
    },
  },
});

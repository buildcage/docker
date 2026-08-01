import { defineConfig } from "vite-plus";

// Committed build artifacts (verified against source by the "Check dist is
// up to date" CI step) — never lint/format generated output.
const generatedOutputs = ["setup/dist/**", "run/dist/**", "report/dist/**", "dist/**"];

// Recorded/golden fixtures: some (e.g. core/lib/log/__fixtures__/*.json) are
// parsed line-by-line to mimic buildctl's real NDJSON-ish log output, so
// pretty-printing them breaks that line structure and fails the tests that
// read them. Fixtures are captured data, not authored code — never reformat
// any of them, even ones that happen to be safe today.
const fixtures = ["**/__fixtures__/**"];

export default defineConfig({
  lint: {
    ignorePatterns: generatedOutputs,
    options: {
      // typescript already at v7 (typescript-go), so tsgolint's type-aware
      // rules apply directly. `pnpm typecheck` (tsc) stays the authoritative
      // full type check; typeCheck (still experimental) is left off here.
      typeAware: true,
    },
  },
  fmt: {
    ignorePatterns: [...generatedOutputs, ...fixtures, "MAINTAINERS.md"],
  },
  staged: {
    "*.{ts,tsx,js,jsx,json,jsonc,yaml,yml,md}": "vp check --fix",
    "run/docker/gen-seccomp-profile/**/*.go": "gofmt -w",
    "setup/docker/explicit/buildkit-proxy/**/*.go": "gofmt -w",
  },
});

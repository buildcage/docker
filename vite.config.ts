import { defineConfig } from "vite-plus";

// Committed build artifacts (verified against source by the "Check dist is
// up to date" CI step) — never lint/format generated output.
const generatedOutputs = ["setup/dist/**", "run/dist/**", "report/dist/**", "dist/**"];

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
    ignorePatterns: generatedOutputs,
  },
  staged: {
    "*.{ts,tsx,js,jsx,json,jsonc,yaml,yml,md}": "vp check --fix",
    "run/docker/gen-seccomp-profile/**/*.go": "gofmt -w",
    "setup/docker/explicit/buildkit-proxy/**/*.go": "gofmt -w",
  },
});

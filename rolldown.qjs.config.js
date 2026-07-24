import { defineConfig } from "rolldown";

// Production QuickJS entry points. Each is bundled into a single
// self-contained ESM file (relative imports like core/shared/lib/rules.ts
// are inlined) so the Dockerfiles can COPY one file per script instead of a
// whole source tree — see rolldown.qjs.test.config.js for the test-only
// counterpart.
const entries = [
  { input: "core/scripts/convert-rule.ts", file: "dist/qjs/core/scripts/convert-rule.js" },
  { input: "core/scripts/report.ts", file: "dist/qjs/core/scripts/report.js" },
  {
    input: "setup/docker/explicit/scripts/gen-source-policy.ts",
    file: "dist/qjs/setup/docker/explicit/scripts/gen-source-policy.js",
  },
  {
    input: "setup/docker/explicit/scripts/report.ts",
    file: "dist/qjs/setup/docker/explicit/scripts/report.js",
  },
];

export default defineConfig(
  entries.map(({ input, file }) => ({
    input,
    // "qjs:std"/"qjs:os" are QuickJS-native builtin modules, not npm
    // packages — leave them as-is instead of trying (and failing) to
    // resolve them.
    external: ["qjs:std", "qjs:os"],
    platform: "neutral",
    output: {
      file,
      format: "esm",
      codeSplitting: false,
      minify: {
        compress: true,
        mangle: false,
        codegen: { removeWhitespace: false, legalComments: "none" },
      },
    },
  })),
);

import { defineConfig } from "rolldown";

// QuickJS test entry points, bundled independently of production scripts
// (see rolldown.qjs.config.js). Each *.test.ts is bundled into a
// self-contained *.test.js that inlines the library it tests and the
// test-shim runner — core/shared/test/run-tests.js then discovers these by
// scanning directories at runtime (os.readdir), exactly as it does today,
// so output paths must mirror the source tree 1:1.
const entries = [
  { input: "core/shared/test/run-tests.ts", file: "dist/test-qjs/core/shared/test/run-tests.js" },
  {
    input: "core/scripts/lib/log-parser.test.ts",
    file: "dist/test-qjs/core/scripts/lib/log-parser.test.js",
  },
  { input: "core/shared/lib/rules.test.ts", file: "dist/test-qjs/core/shared/lib/rules.test.js" },
  {
    input: "core/shared/lib/aggregate.test.ts",
    file: "dist/test-qjs/core/shared/lib/aggregate.test.js",
  },
  {
    input: "core/shared/lib/parse-identifier.test.ts",
    file: "dist/test-qjs/core/shared/lib/parse-identifier.test.js",
  },
  {
    input: "setup/docker/explicit/scripts/lib/source-policy.test.ts",
    file: "dist/test-qjs/setup/docker/explicit/scripts/lib/source-policy.test.js",
  },
  {
    input: "setup/docker/explicit/scripts/lib/buildkitd-log-parser.test.ts",
    file: "dist/test-qjs/setup/docker/explicit/scripts/lib/buildkitd-log-parser.test.js",
  },
];

export default defineConfig(
  entries.map(({ input, file }) => ({
    input,
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

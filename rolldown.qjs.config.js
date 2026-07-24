import { globSync } from "node:fs";
import { defineConfig } from "rolldown";

// Non-recursive: these directories hold only qjs entry points; their shared
// dependencies live in core/lib and get pulled in transitively by rolldown.
const productionInputs = globSync(["core/scripts/*.ts", "setup/docker/explicit/scripts/*.ts"]);

// *.property.test.ts run under node:test, not qjs — excluded here.
// Output paths must mirror the source tree 1:1: run-tests.qjs.js discovers
// these by scanning directories at runtime (os.readdir).
const testInputs = [
  "core/scripts/test/run-tests.qjs.ts",
  ...globSync(
    ["core/lib/acl/*.test.ts", "core/lib/log/*.test.ts"],
    { exclude: ["**/*.property.test.ts"] },
  ),
];

const [inputs, outDir] =
  process.env.QJS_BUILD_TARGET === "test" ? [testInputs, "dist/test-qjs"] : [productionInputs, "dist/qjs"];

export default defineConfig(
  inputs.map((input) => ({
    input,
    // QuickJS-native builtins, not npm packages — don't try to resolve them.
    external: ["qjs:std", "qjs:os"],
    platform: "neutral",
    output: {
      file: `${outDir}/${input.replace(/\.ts$/, ".js")}`,
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

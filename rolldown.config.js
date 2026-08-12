import { defineConfig } from "rolldown";
import { replacePlugin } from "rolldown/plugins";

// Plugin required to substitute BUILDCAGE_BUILD_TEST_HOOKS at build time.
// Applied to src/main.js and report/src/main.js only.
//
// replacePlugin() substitutes BUILDCAGE_BUILD_TEST_HOOKS with the value from
// this build's own env, not the resulting action's runtime env — see
// LOCAL_IMAGE_OVERRIDE_ENABLED in src/main.js.
const mainPlugins = [
  replacePlugin({
    "process.env.BUILDCAGE_BUILD_TEST_HOOKS": JSON.stringify(
      process.env.BUILDCAGE_BUILD_TEST_HOOKS ?? "",
    ),
  }),
];

const configs = [
  {
    input: "src/main.ts",
    file: "dist/main.cjs",
    plugins: mainPlugins,
    // sigstore uses dynamic imports; inline them so dist is a single file.
    codeSplitting: false,
  },
  {
    input: "src/post.ts",
    file: "dist/post.cjs",
    plugins: mainPlugins,
  },
  {
    input: "report/src/main.ts",
    file: "report/dist/main.cjs",
    plugins: mainPlugins,
  },
];

export default defineConfig(
  configs.map(({ input, file, plugins, codeSplitting = true }) => ({
    input,
    external: [/^node:/],
    platform: "node",
    treeshake: {
      moduleSideEffects: [{ test: /\/(@actions\/http-client|undici)\//, sideEffects: false }],
    },
    plugins,
    output: {
      file,
      format: "cjs",
      codeSplitting,
      minify: {
        compress: true,
        mangle: false,
        codegen: { removeWhitespace: false, legalComments: "none" },
      },
    },
  })),
);

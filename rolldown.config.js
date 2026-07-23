import { defineConfig } from "rolldown";
import { replacePlugin } from "rolldown/plugins";

// Plugin required to substitute BUILDCAGE_BUILD_TEST_HOOKS at build time.
// Applied to setup/src/main.js; other entries have no need for it.
//
// replacePlugin() substitutes BUILDCAGE_BUILD_TEST_HOOKS with the value from
// this build's own env, not the resulting action's runtime env — see
// LOCAL_IMAGE_OVERRIDE_ENABLED in setup/src/main.js.
const mainPlugins = [
  replacePlugin({
    "process.env.BUILDCAGE_BUILD_TEST_HOOKS": JSON.stringify(
      process.env.BUILDCAGE_BUILD_TEST_HOOKS ?? "",
    ),
  }),
];

const configs = [
  {
    input: "setup/src/main.ts",
    file: "setup/dist/main.cjs",
    plugins: mainPlugins,
    // sigstore uses dynamic imports; inline them so dist is a single file.
    codeSplitting: false,
  },
  { input: "setup/src/post.ts", file: "setup/dist/post.cjs" },
  { input: "report/src/main.ts", file: "report/dist/main.cjs" },
  {
    input: "run/src/main.ts",
    file: "run/dist/main.cjs",
    // Pulls in setup/src/lib/verify-image.js, which uses sigstore the same
    // way setup/src/main.js does — same plugin set for the same reason.
    plugins: mainPlugins,
    codeSplitting: false,
  },
  { input: "run/src/post.ts", file: "run/dist/post.cjs" },
];

export default defineConfig(
  configs.map(({ input, file, plugins = [], codeSplitting = true }) => ({
    input,
    external: [/^node:/],
    platform: "node",
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

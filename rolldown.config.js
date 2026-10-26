import { defineConfig } from "rolldown";
import { replacePlugin } from "rolldown/plugins";

// replacePlugin() substitutes BUILDCAGE_BUILD_TEST_HOOKS with the value from
// this build's own env, not the resulting action's runtime env; see
// the gate in src/lib/local-image.ts.
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
  configs.map(({ input, file, plugins }) => ({
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
      // Each bundle is one file, with what it imports dynamically inlined:
      // sigstore, @actions/artifact (which a run that asks for no artifact
      // never loads) and, in a test-hook build, the local-image override.
      codeSplitting: false,
      comments: false,
      minify: {
        compress: true,
        mangle: false,
        codegen: { removeWhitespace: false },
      },
    },
  })),
);

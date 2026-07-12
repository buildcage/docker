import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import terser from "@rollup/plugin-terser";
import replace from "@rollup/plugin-replace";

// Plugins required to bundle sigstore and its CJS/JSON dependencies.
// Applied to setup/src/main.js; other entries have no external deps.
//
// replace() substitutes BUILDCAGE_BUILD_TEST_HOOKS with the value from this
// build's own env, not the resulting action's runtime env — see
// LOCAL_IMAGE_OVERRIDE_ENABLED in setup/src/main.js.
const mainPlugins = [
  replace({
    preventAssignment: true,
    values: {
      "process.env.BUILDCAGE_BUILD_TEST_HOOKS": JSON.stringify(
        process.env.BUILDCAGE_BUILD_TEST_HOOKS ?? "",
      ),
    },
  }),
  resolve({ preferBuiltins: true }),
  commonjs(),
  json(),
];

const configs = [
  {
    input: "setup/src/main.js",
    file: "setup/dist/main.cjs",
    plugins: mainPlugins,
    // sigstore uses dynamic imports; inline them so dist is a single file.
    inlineDynamicImports: true,
  },
  { input: "setup/src/post.js", file: "setup/dist/post.cjs", plugins: [] },
  { input: "report/src/main.js", file: "report/dist/main.cjs", plugins: [] },
];

export default configs.map(
  ({ input, file, plugins, inlineDynamicImports = false }) => ({
    input,
    external: /^node:/,
    plugins,
    output: {
      file,
      format: "cjs",
      inlineDynamicImports,
      plugins: [
        terser({
          compress: true,
          mangle: false,
          format: { comments: false, indent_level: 2, beautify: true },
        }),
      ],
    },
  }),
);

const resolve = require("@rollup/plugin-node-resolve");
const commonjs = require("@rollup/plugin-commonjs");
const json = require("@rollup/plugin-json");
const terser = require("@rollup/plugin-terser");

// Plugins required to bundle sigstore and its CJS/JSON dependencies.
// Applied to setup/src/main.mjs; other entries have no external deps.
const mainPlugins = [
  resolve.default({ preferBuiltins: true }),
  commonjs(),
  json(),
];

const configs = [
  {
    input: "setup/src/main.mjs",
    file: "setup/dist/main.js",
    plugins: mainPlugins,
    // sigstore uses dynamic imports; inline them so dist is a single file.
    inlineDynamicImports: true,
  },
  { input: "setup/src/post.mjs", file: "setup/dist/post.js", plugins: [] },
  { input: "report/src/main.mjs", file: "report/dist/main.js", plugins: [] },
];

module.exports = configs.map(
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

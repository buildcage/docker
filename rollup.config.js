const terser = require("@rollup/plugin-terser");

const configs = [
  { input: "setup/src/main.mjs", file: "setup/dist/main.js" },
  { input: "setup/src/post.mjs", file: "setup/dist/post.js" },
  { input: "report/src/main.mjs", file: "report/dist/main.js" },
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

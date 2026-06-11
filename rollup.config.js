const configs = [
  { input: 'setup/src/pre.mjs',    file: 'setup/dist/pre.js' },
  { input: 'setup/src/main.mjs',   file: 'setup/dist/main.js' },
  { input: 'setup/src/post.mjs',   file: 'setup/dist/post.js' },
  { input: 'report/src/index.mjs', file: 'report/dist/index.js' },
];

module.exports = configs.map(({ input, file }) => ({
  input,
  external: /^node:/,
  output: { file, format: 'cjs' },
}));

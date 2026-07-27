import { globSync } from "node:fs";
import { defineConfig } from "rolldown";

// A dedicated config (like build:qjs) so the report-action-build Docker
// stage doesn't need to COPY setup/src, report/src, run/src just to
// satisfy rolldown.config.js's other, unrelated entries.
const inputs = globSync(["setup/docker/*/scripts/*.node.ts"]);

export default defineConfig(
  inputs.map((input) => ({
    input,
    external: [/^node:/],
    platform: "node",
    output: {
      // Strips .node too, so the output matches what main.ts fetches.
      file: `dist/report-action/${input.replace(/\.node\.ts$/, ".js")}`,
      format: "cjs",
      codeSplitting: false,
      minify: {
        compress: true,
        mangle: false,
        codegen: { removeWhitespace: false, legalComments: "none" },
      },
    },
  })),
);

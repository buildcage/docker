import { globSync } from "node:fs";
import { defineConfig } from "rolldown";

// One report-action.node.ts per engine, each baked into that engine's own
// image by its own Docker build stage — see setup/docker/{transparent,
// explicit}/Dockerfile's report-action-build stage. A dedicated config
// (rather than folding these into rolldown.config.js's own array) so that
// stage doesn't need to COPY setup/src, report/src, run/src just to
// satisfy the other unrelated entries — same reasoning as build:qjs
// already being split out.
const inputs = globSync(["setup/docker/*/scripts/*.node.ts"]);

export default defineConfig(
  inputs.map((input) => ({
    input,
    external: [/^node:/],
    platform: "node",
    output: {
      // Strips the .node from the filename too, so the built artifact is
      // just report-action.js, matching what report/src/main.ts fetches.
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

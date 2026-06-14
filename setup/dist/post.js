"use strict";

var node_child_process = require("node:child_process"), node_path = require("node:path"), node_url = require("node:url"), _documentCurrentScript = "undefined" != typeof document ? document.currentScript : null;

const __dirname$1 = node_path.dirname(node_url.fileURLToPath("undefined" == typeof document ? require("url").pathToFileURL(__filename).href : _documentCurrentScript && "SCRIPT" === _documentCurrentScript.tagName.toUpperCase() && _documentCurrentScript.src || new URL("post.js", document.baseURI).href));

node_child_process.execFileSync("docker", [ "compose", "-f", node_path.join(__dirname$1, "../compose.yaml"), "down" ], {
  stdio: "inherit",
  env: {
    ...process.env,
    BUILDER_NAME: process.env.INPUT_BUILDER_NAME || "buildcage"
  }
});

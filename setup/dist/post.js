'use strict';

var node_child_process = require('node:child_process');
var node_path = require('node:path');
var node_url = require('node:url');

var _documentCurrentScript = typeof document !== 'undefined' ? document.currentScript : null;
const __dirname$1 = node_path.dirname(node_url.fileURLToPath((typeof document === 'undefined' ? require('u' + 'rl').pathToFileURL(__filename).href : (_documentCurrentScript && _documentCurrentScript.tagName.toUpperCase() === 'SCRIPT' && _documentCurrentScript.src || new URL('post.js', document.baseURI).href))));

node_child_process.execFileSync(
  "docker",
  ["compose", "-f", node_path.join(__dirname$1, "../compose.yml"), "down"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      BUILDER_NAME: process.env.INPUT_BUILDER_NAME || "buildcage",
    },
  }
);

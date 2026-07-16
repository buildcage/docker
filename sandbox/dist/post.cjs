"use strict";

var node_child_process = require("node:child_process"), node_path = require("node:path"), node_url = require("node:url"), _documentCurrentScript = "undefined" != typeof document ? document.currentScript : null;

const __dirname$1 = node_path.dirname(node_url.fileURLToPath("undefined" == typeof document ? require("url").pathToFileURL(__filename).href : _documentCurrentScript && "SCRIPT" === _documentCurrentScript.tagName.toUpperCase() && _documentCurrentScript.src || new URL("post.cjs", document.baseURI).href)), containerName = process.env.STATE_container_name, projectName = process.env.STATE_project_name;

containerName && projectName ? node_child_process.execFileSync("docker", function({composeFile: composeFile, projectName: projectName}) {
  return [ "compose", "-f", composeFile, "-p", projectName, "down" ];
}({
  composeFile: node_path.join(__dirname$1, "../compose.yaml"),
  projectName: projectName
}), {
  stdio: "inherit",
  env: {
    ...process.env,
    SANDBOX_CONTAINER_NAME: containerName
  }
}) : containerName && console.log(`::warning::sandbox post-cleanup: container_name is set but project_name is missing from GITHUB_STATE; skipping cleanup to avoid targeting Compose's implicit, shared project name. Container ${containerName} may need manual removal.`);

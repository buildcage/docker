let node_child_process = require("node:child_process"), node_path = require("node:path"), node_url = require("node:url");
//#region setup/src/post.js
(0, node_child_process.execFileSync)("docker", [
	"compose",
	"-f",
	(0, node_path.join)((0, node_path.dirname)((0, node_url.fileURLToPath)(require("url").pathToFileURL(__filename).href)), "../compose.yaml"),
	"down"
], {
	stdio: "inherit",
	env: {
		...process.env,
		BUILDER_NAME: process.env.INPUT_BUILDER_NAME || "buildcage"
	}
});
//#endregion

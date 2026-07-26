let node_child_process = require("node:child_process"), node_path = require("node:path"), node_url = require("node:url"), node_crypto = require("node:crypto");
//#region core/lib/docker/container.ts
/**
* An explicit, deterministic Compose project name, so concurrent
* `up`/`down`/`ps` from different steps in the same job never collide on
* Compose's shared, directory-derived default.
*
* Hashed rather than used verbatim: Compose project names are constrained
* to `^[a-z0-9][a-z0-9_-]*$`, but the input can be a wider-charset
* user-supplied `builder_name` — a hex digest is always in-charset
* regardless, so this never needs to validate its input.
*/
function deriveProjectName(containerName) {
	return `buildcage-${(0, node_crypto.createHash)("sha256").update(containerName).digest("hex").slice(0, 12)}`;
}
//#endregion
//#region setup/src/post.ts
const __dirname$1 = (0, node_path.dirname)((0, node_url.fileURLToPath)(require("url").pathToFileURL(__filename).href)), builderName = process.env.INPUT_BUILDER_NAME || "buildcage";
(0, node_child_process.execFileSync)("docker", [
	"compose",
	"-p",
	deriveProjectName(builderName),
	"-f",
	(0, node_path.join)(__dirname$1, "../compose.yaml"),
	"down"
], {
	stdio: "inherit",
	env: {
		...process.env,
		BUILDER_NAME: builderName
	}
});
//#endregion

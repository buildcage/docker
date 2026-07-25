let node_child_process = require("node:child_process"), node_path = require("node:path"), node_url = require("node:url"), node_crypto = require("node:crypto");
//#region core/lib/docker/container.ts
/**
* Derives a Compose project name (a separate Docker namespace from
* container names, so no collision risk there) from a container/builder
* name. Passing an explicit, deterministic project name matters when
* multiple steps/containers in the same job run concurrently: without it,
* Compose falls back to one shared, directory-derived project name, and a
* concurrent `up`/`down`/`ps` from a different step can recreate, tear
* down, or misidentify another step's container.
*
* Hashed rather than used verbatim: Compose project names are constrained
* to `^[a-z0-9][a-z0-9_-]*$`, but the input here can be a user-supplied
* `builder_name` (setup/report's own input, which only ever had to be a
* valid Docker container name — a wider character set, e.g. uppercase) or
* run's own randomly-generated container name. A hex digest is always
* within Compose's charset regardless of what the input looked like, so
* this never needs to validate or reject its input.
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

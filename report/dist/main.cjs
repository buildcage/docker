Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let node_child_process = require("node:child_process"), node_fs = require("node:fs"), node_os = require("node:os"), node_path = require("node:path"), node_url = require("node:url"), node_crypto = require("node:crypto"), node_events = require("node:events"), node_readline = require("node:readline");
/**
* Turns a caught `docker` invocation error into an actionable message,
* pointing at the runner requirement instead of surfacing execFileSync's
* opaque "Command failed: docker ...args..." text. Deliberately doesn't
* echo `e.message` when stderr was inherited (already visible live in the
* Actions log) — only captured stderr (e.g. from a piped call) is included,
* since otherwise nothing points the reader back to it.
*/
function describeDockerFailure(e, { operation = "docker", env = process.env, exists = node_fs.existsSync } = {}) {
	let err = e && typeof e == "object" ? e : {}, slimNote = isLikelySlimRunner(env, exists) ? " Detected a container-based GitHub-hosted runner image (e.g. \"ubuntu-slim\") — these ship a Docker client with no daemon and are not supported for this action." : "", whatHappened;
	if (err.code === "ENOENT") whatHappened = `The "docker" command was not found on this runner's PATH while running ${operation}.`;
	else {
		let captured = typeof err.stderr == "string" ? err.stderr.trim() : "";
		whatHappened = `${operation} failed${captured ? `: ${captured}` : " (see the Docker output above for the underlying error)"}.`;
	}
	return `${whatHappened}${slimNote} Buildcage requires a working Docker installation (client and daemon) on the runner. Lightweight runner images such as GitHub-hosted "ubuntu-slim" ship a Docker client but no daemon and are not supported for this action — use "ubuntu-latest" (or another runner with a full Docker install) instead. See docs/reference.md and docs/security.md for details.`;
}
/**
* Best-effort detection of GitHub's container-based hosted runner images
* (currently: ubuntu-slim) — these run jobs inside a container rather than
* a dedicated VM, so unlike VM-based ubuntu-latest/22.04/24.04/26.04 they
* ship a Docker client with no daemon.
*
* Not an official/documented API: ImageOS is hardcoded to "Linux" (vs.
* "ubuntu24" etc. on VM images) and /run/.containerenv is baked into the
* image at build time by GitHub's own Dockerfile
* (github.com/actions/runner-images/blob/main/images/ubuntu-slim/Dockerfile).
* Both signals could change without notice — failing to detect just falls
* back to the generic message in describeDockerFailure, so this is safe to
* get wrong.
*/
function isLikelySlimRunner(_env = process.env, _exists = node_fs.existsSync) {
	return _env.ImageOS === "Linux" && _exists("/run/.containerenv");
}
//#endregion
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
function buildDockerCpArgs({ containerName, containerPath, hostPath }) {
	return [
		"cp",
		`${containerName}:${containerPath}`,
		hostPath
	];
}
//#endregion
//#region core/lib/docker/container-env.ts
/**
* Parses `docker inspect <id> --format '{{json .Config.Env}}'`'s output — a
* JSON array of "KEY=VALUE" strings — into a lookup map. Used to read a
* running container's own env from the runner side (report-action.node.ts
* doesn't run inside the container, so it can't read process.env directly).
*/
function parseDockerInspectEnv(inspectOutput) {
	let entries = JSON.parse(inspectOutput), env = {};
	for (let entry of entries) {
		let i = entry.indexOf("=");
		i !== -1 && (env[entry.slice(0, i)] = entry.slice(i + 1));
	}
	return env;
}
//#endregion
//#region core/lib/docker/client.ts
/** `docker ps --format '{{.ID}}'` prints one ID per line, possibly with
*  trailing blank lines. */
function parseContainerIds(psOutput) {
	return psOutput.split("\n").map((s) => s.trim()).filter(Boolean);
}
function defaultRunCommand(args) {
	return (0, node_child_process.execFileSync)("docker", args, {
		encoding: "utf8",
		stdio: [
			"ignore",
			"pipe",
			"pipe"
		],
		maxBuffer: 64 * 1024 * 1024
	});
}
function defaultSpawnCommand(args) {
	return (0, node_child_process.spawn)("docker", args, { stdio: [
		"ignore",
		"pipe",
		"pipe"
	] });
}
/**
* Drives a `docker <args>` child process and yields its stdout line by
* line, never buffering more than the current line. Lazy — nothing spawns
* until the caller starts iterating.
*
* Throws `{status, stderr}` on a non-zero exit and Node's own
* `{code: "ENOENT", ...}` on a spawn failure, matching the shape
* describeDockerFailure() (core/lib/actions/docker-error.ts) expects from
* execFileSync elsewhere in this module.
*/
async function* streamDockerLines(spawnDocker, args, operation) {
	let child = spawnDocker(args), spawnError;
	child.on("error", (err) => {
		spawnError = err;
	});
	let closed = (0, node_events.once)(child, "close").then(([code, signal]) => ({
		code,
		signal
	}), () => ({
		code: null,
		signal: null
	})), stderr = "";
	child.stderr?.setEncoding("utf8"), child.stderr?.on("data", (chunk) => {
		stderr += chunk;
	});
	let rl = (0, node_readline.createInterface)({
		input: child.stdout,
		crlfDelay: Infinity
	}), exhausted = !1;
	try {
		for await (let line of rl) yield line;
		exhausted = !0;
	} finally {
		rl.close(), !exhausted && child.exitCode === null && child.signalCode === null && child.kill();
	}
	if (!exhausted) return;
	let { code, signal } = await closed;
	if (spawnError) throw spawnError;
	if (code !== 0) throw Object.assign(/* @__PURE__ */ Error(`${operation} exited with code ${code}${signal ? ` (signal ${signal})` : ""}: ${stderr.trim()}`), {
		status: code ?? void 0,
		stderr
	});
}
/** `run`/`spawnDocker` are injectable so tests can assert on argv instead of
*  mocking node:child_process directly. */
function createDocker(run = defaultRunCommand, spawnDocker = defaultSpawnCommand) {
	return {
		findContainers(filters) {
			let args = ["ps"];
			for (let filter of filters) args.push("--filter", filter);
			return args.push("--format", "{{.ID}}"), parseContainerIds(run(args));
		},
		copyFromContainer(containerId, containerPath, hostPath) {
			run(buildDockerCpArgs({
				containerName: containerId,
				containerPath,
				hostPath
			}));
		},
		readFileLines(containerId, path) {
			return streamDockerLines(spawnDocker, [
				"exec",
				containerId,
				"cat",
				path
			], `docker exec cat ${path}`);
		},
		readEnv(containerId) {
			return parseDockerInspectEnv(run([
				"inspect",
				containerId,
				"--format",
				"{{json .Config.Env}}"
			]));
		},
		exec(containerId, args) {
			return run([
				"exec",
				containerId,
				...args
			]);
		}
	};
}
//#endregion
//#region core/lib/general/action-error.ts
/**
* Base class for an action's own "intentional" errors — a caught failure
* whose message is safe to print directly via ::error::, as opposed to an
* unexpected one. A top-level catch checks `instanceof ActionError`.
* `name` is derived from `new.target`, so a subclass needs no constructor
* of its own to get its own name.
*/
var ActionError = class extends Error {
	code;
	constructor(message, code) {
		super(message), this.name = new.target.name, this.code = code;
	}
};
//#endregion
//#region core/lib/general/error-message.ts
/**
* Safely extract a message from a caught value of unknown shape — a plain
* `Error` most of the time, but `catch` doesn't guarantee that.
*/
function errorMessage(e) {
	return e instanceof Error ? e.message : String(e);
}
//#endregion
//#region report/src/lib/errors.ts
/**
* ReportError — intentional error in the report action's own logic. Invalid
* ACL rule syntax throws InvalidRulesError instead (see
* core/lib/acl/rules.ts).
*
* Codes:
*   DOCKER_UNAVAILABLE   – docker CLI missing from PATH, or `docker ps`/`docker cp` failed
*   CONTAINER_NOT_FOUND  – `docker ps --filter` didn't find exactly one
*                          report-source container for this builder_name
*   REPORT_SCRIPT_FAILED – report-action.js couldn't even be launched (a
*                          report-action.js that ran and exited nonzero is
*                          reproduced via this action's exit code instead)
*/
var ReportError = class extends ActionError {};
//#endregion
//#region report/src/main.ts
function resolveProjectName(builderName, env) {
	return deriveProjectName(builderName);
}
async function main() {
	let builderName = process.env.INPUT_BUILDER_NAME || "buildcage", projectName = resolveProjectName(builderName, process.env), docker = createDocker(), containerId;
	try {
		let ids = docker.findContainers([`label=com.docker.compose.project=${projectName}`, "label=io.github.buildcage.report-source=true"]);
		if (ids.length !== 1) throw new ReportError(`Expected exactly one buildcage container for builder_name ${JSON.stringify(builderName)}, found ${ids.length}. Did the setup step run first, with the same builder_name?`, "CONTAINER_NOT_FOUND");
		containerId = ids[0];
	} catch (e) {
		throw e instanceof ReportError ? e : new ReportError(describeDockerFailure(e, { operation: "docker ps" }), "DOCKER_UNAVAILABLE");
	}
	let scratchDir = (0, node_fs.mkdtempSync)((0, node_path.join)((0, node_os.tmpdir)(), "buildcage-report-"));
	try {
		let reportActionPath = (0, node_path.join)(scratchDir, "report-action.js");
		try {
			docker.copyFromContainer(containerId, "/opt/buildcage/scripts/report-action.js", reportActionPath);
		} catch (e) {
			throw new ReportError(describeDockerFailure(e, { operation: "docker cp (fetching report-action.js from the container)" }), "DOCKER_UNAVAILABLE");
		}
		try {
			(0, node_child_process.execFileSync)("node", [reportActionPath, containerId], { stdio: "inherit" });
		} catch (e) {
			let status = e.status;
			if (typeof status == "number") {
				process.exitCode = status;
				return;
			}
			throw new ReportError(`Failed to run report-action.js: ${errorMessage(e)}`, "REPORT_SCRIPT_FAILED");
		}
	} finally {
		(0, node_fs.rmSync)(scratchDir, {
			recursive: !0,
			force: !0
		});
	}
}
//#endregion
process.argv[1] === (0, node_url.fileURLToPath)(require("url").pathToFileURL(__filename).href) && main().catch((err) => {
	err instanceof ActionError ? console.log(`::error::${err.message}`) : console.log(`::error::Unexpected error in report: ${errorMessage(err)}`), process.exit(1);
}), exports.resolveProjectName = resolveProjectName;

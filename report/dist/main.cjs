Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let node_child_process = require("node:child_process"), node_fs = require("node:fs"), node_os = require("node:os"), node_path = require("node:path"), node_url = require("node:url"), node_crypto = require("node:crypto");
//#region core/lib/actions/annotation.ts
/**
* Build a GitHub Actions annotation emitter. When `enabled` is false, every
* method is a no-op — used to suppress annotations when this script isn't
* running as the real action.
*/
function createAnnotation(enabled) {
	return enabled ? {
		notice(message) {
			console.log(`::notice::${message}`);
		},
		warning(message) {
			console.log(`::warning::${message}`);
		},
		error(message) {
			console.log(`::error::${message}`);
		}
	} : {
		notice() {},
		warning() {},
		error() {}
	};
}
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
function buildDockerCpArgs({ containerName, containerPath, hostPath }) {
	return [
		"cp",
		`${containerName}:${containerPath}`,
		hostPath
	];
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
*   REPORT_SCRIPT_FAILED – report.sh itself (or making it executable) failed
*                          after being fetched from the container — not
*                          necessarily a Docker/runner problem, so this is
*                          kept distinct from DOCKER_UNAVAILABLE
*/
var ReportError = class extends ActionError {};
//#endregion
//#region report/src/main.ts
/**
* `docker ps --format '{{.ID}}'` prints one ID per line, possibly with
* trailing blank lines — exported for unit testing without a real daemon.
*/
function parseContainerIds(psOutput) {
	return psOutput.split("\n").map((s) => s.trim()).filter(Boolean);
}
/**
* Audit mode never fails regardless of blocked connections — `blocked` is
* only ever set (see core/scripts/report.ts) when mode is "restrict".
*/
function shouldFailOnBlocked(report, failOnBlocked) {
	return report.mode === "restrict" && report.blocked === !0 && failOnBlocked;
}
/**
* Maps a LogEntry's level (see core/lib/log/log-entries.ts) to the console
* method that prints it. Unrecognized levels fall back to "log" so an older
* report build stays usable against a newer report.js.
*/
function consoleMethodForLevel(level) {
	switch (level) {
		case "debug": return "debug";
		case "warning": return "warn";
		case "error": return "error";
		default: return "log";
	}
}
/**
* report.js can't know its own actionRepo/actionRef (those only exist in
* the `report` action step's own GitHub Actions runtime, not inside the
* container), so it leaves these two placeholders in stepSummary instead.
* Substituting them here in JS, scoped to just the stepSummary string
* (never logs, never the raw JSON text), means: no shell quoting/sed
* delimiter concerns with ref/repo values, and proxy-log content a build
* step could influence — which flows into logs and stepSummary's own
* host/URL tables — is never in scope for the substitution to begin with.
*/
function substituteActionPlaceholders(stepSummary, env) {
	return stepSummary.replaceAll("{{GITHUB_ACTION_REPOSITORY}}", env.GITHUB_ACTION_REPOSITORY || "").replaceAll("{{GITHUB_ACTION_REF}}", env.GITHUB_ACTION_REF || "");
}
async function main() {
	let builderName = process.env.INPUT_BUILDER_NAME || "buildcage", projectName = deriveProjectName(builderName), summaryFile = process.env.GITHUB_STEP_SUMMARY, annotation = createAnnotation(!!summaryFile), containerId;
	try {
		let ids = parseContainerIds((0, node_child_process.execFileSync)("docker", [
			"ps",
			"--filter",
			`label=com.docker.compose.project=${projectName}`,
			"--filter",
			"label=io.github.dash14.buildcage.report-source=true",
			"--format",
			"{{.ID}}"
		], {
			encoding: "utf8",
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			]
		}));
		if (ids.length !== 1) throw new ReportError(`Expected exactly one buildcage container for builder_name ${JSON.stringify(builderName)}, found ${ids.length}. Did the setup step run first, with the same builder_name?`, "CONTAINER_NOT_FOUND");
		containerId = ids[0];
	} catch (e) {
		throw e instanceof ReportError ? e : new ReportError(describeDockerFailure(e, { operation: "docker ps" }), "DOCKER_UNAVAILABLE");
	}
	let scratchDir = (0, node_fs.mkdtempSync)((0, node_path.join)((0, node_os.tmpdir)(), "buildcage-report-")), jsonOutput;
	try {
		let reportScriptPath = (0, node_path.join)(scratchDir, "report.sh");
		try {
			(0, node_child_process.execFileSync)("docker", buildDockerCpArgs({
				containerName: containerId,
				containerPath: "/opt/buildcage/scripts/report.sh",
				hostPath: reportScriptPath
			}), { stdio: [
				"ignore",
				"pipe",
				"pipe"
			] });
		} catch (e) {
			throw new ReportError(describeDockerFailure(e, { operation: "docker cp (fetching report.sh from the container)" }), "DOCKER_UNAVAILABLE");
		}
		try {
			(0, node_fs.chmodSync)(reportScriptPath, 448), jsonOutput = (0, node_child_process.execFileSync)(reportScriptPath, [containerId], {
				encoding: "utf8",
				stdio: [
					"ignore",
					"pipe",
					"pipe"
				]
			});
		} catch (e) {
			let stderr = typeof e.stderr == "string" ? e.stderr.trim() : "";
			throw new ReportError(`report.sh failed${stderr ? `: ${stderr}` : ` (${errorMessage(e)})`}`, "REPORT_SCRIPT_FAILED");
		}
	} finally {
		(0, node_fs.rmSync)(scratchDir, {
			recursive: !0,
			force: !0
		});
	}
	let report = JSON.parse(jsonOutput);
	report.stepSummary = substituteActionPlaceholders(report.stepSummary, process.env);
	for (let entry of report.logs ?? []) console[consoleMethodForLevel(entry.level)](entry.log);
	summaryFile ? (0, node_fs.appendFileSync)(summaryFile, report.stepSummary) : console.log(report.stepSummary), report.mode === null && process.exit(0);
	let failOnBlocked = (process.env.INPUT_FAIL_ON_BLOCKED || "true").toLowerCase() === "true";
	report.message && (shouldFailOnBlocked(report, failOnBlocked) ? (annotation.error(report.message), process.exitCode = 1) : annotation.notice(report.message));
}
process.argv[1] === (0, node_url.fileURLToPath)(require("url").pathToFileURL(__filename).href) && main().catch((err) => {
	err instanceof ActionError ? console.log(`::error::${err.message}`) : console.log(`::error::Unexpected error in report: ${errorMessage(err)}`), process.exit(1);
}), exports.consoleMethodForLevel = consoleMethodForLevel, exports.parseContainerIds = parseContainerIds, exports.shouldFailOnBlocked = shouldFailOnBlocked, exports.substituteActionPlaceholders = substituteActionPlaceholders;

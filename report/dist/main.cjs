//#region \0rolldown/runtime.js
var __create = Object.create, __defProp = Object.defineProperty, __getOwnPropDesc = Object.getOwnPropertyDescriptor, __getOwnPropNames = Object.getOwnPropertyNames, __getProtoOf = Object.getPrototypeOf, __hasOwnProp = Object.prototype.hasOwnProperty, __copyProps = (to, from, except, desc) => {
	if (from && typeof from == "object" || typeof from == "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) key = keys[i], !__hasOwnProp.call(to, key) && key !== except && __defProp(to, key, {
		get: ((k) => from[k]).bind(null, key),
		enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
	});
	return to;
}, __toESM = (mod, isNodeMode, target) => (target = mod == null ? {} : __create(__getProtoOf(mod)), __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: !0
}) : target, mod));
//#endregion
let node_child_process = require("node:child_process"), node_fs = require("node:fs"), node_os = require("node:os"), node_path = require("node:path"), node_url = require("node:url"), os = require("os");
os = __toESM(os, 1);
let fs = require("fs");
fs = __toESM(fs, 1);
let path = require("path");
path = __toESM(path, 1);
let events = require("events");
events = __toESM(events, 1);
let node_events = require("node:events"), node_crypto = require("node:crypto"), child_process = require("child_process");
child_process = __toESM(child_process, 1), require("timers");
let node_readline = require("node:readline");
//#endregion
//#region node_modules/.pnpm/@actions+core@3.0.1/node_modules/@actions/core/lib/summary.js
var __awaiter$6 = function(thisArg, _arguments, P, generator) {
	function adopt(value) {
		return value instanceof P ? value : new P(function(resolve) {
			resolve(value);
		});
	}
	return new (P ||= Promise)(function(resolve, reject) {
		function fulfilled(value) {
			try {
				step(generator.next(value));
			} catch (e) {
				reject(e);
			}
		}
		function rejected(value) {
			try {
				step(generator.throw(value));
			} catch (e) {
				reject(e);
			}
		}
		function step(result) {
			result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
		}
		step((generator = generator.apply(thisArg, _arguments || [])).next());
	});
};
const { access, appendFile, writeFile } = fs.promises, SUMMARY_ENV_VAR = "GITHUB_STEP_SUMMARY";
new class {
	constructor() {
		this._buffer = "";
	}
	/**
	* Finds the summary file path from the environment, rejects if env var is not found or file does not exist
	* Also checks r/w permissions.
	*
	* @returns step summary file path
	*/
	filePath() {
		return __awaiter$6(this, void 0, void 0, function* () {
			if (this._filePath) return this._filePath;
			let pathFromEnv = process.env[SUMMARY_ENV_VAR];
			if (!pathFromEnv) throw Error(`Unable to find environment variable for $${SUMMARY_ENV_VAR}. Check if your runtime environment supports job summaries.`);
			try {
				yield access(pathFromEnv, fs.constants.R_OK | fs.constants.W_OK);
			} catch {
				throw Error(`Unable to access summary file: '${pathFromEnv}'. Check if the file has correct read/write permissions.`);
			}
			return this._filePath = pathFromEnv, this._filePath;
		});
	}
	/**
	* Wraps content in an HTML tag, adding any HTML attributes
	*
	* @param {string} tag HTML tag to wrap
	* @param {string | null} content content within the tag
	* @param {[attribute: string]: string} attrs key-value list of HTML attributes to add
	*
	* @returns {string} content wrapped in HTML element
	*/
	wrap(tag, content, attrs = {}) {
		let htmlAttrs = Object.entries(attrs).map(([key, value]) => ` ${key}="${value}"`).join("");
		return content ? `<${tag}${htmlAttrs}>${content}</${tag}>` : `<${tag}${htmlAttrs}>`;
	}
	/**
	* Writes text in the buffer to the summary buffer file and empties buffer. Will append by default.
	*
	* @param {SummaryWriteOptions} [options] (optional) options for write operation
	*
	* @returns {Promise<Summary>} summary instance
	*/
	write(options) {
		return __awaiter$6(this, void 0, void 0, function* () {
			let overwrite = !!options?.overwrite, filePath = yield this.filePath();
			return yield (overwrite ? writeFile : appendFile)(filePath, this._buffer, { encoding: "utf8" }), this.emptyBuffer();
		});
	}
	/**
	* Clears the summary buffer and wipes the summary file
	*
	* @returns {Summary} summary instance
	*/
	clear() {
		return __awaiter$6(this, void 0, void 0, function* () {
			return this.emptyBuffer().write({ overwrite: !0 });
		});
	}
	/**
	* Returns the current summary buffer as a string
	*
	* @returns {string} string of summary buffer
	*/
	stringify() {
		return this._buffer;
	}
	/**
	* If the summary buffer is empty
	*
	* @returns {boolen} true if the buffer is empty
	*/
	isEmptyBuffer() {
		return this._buffer.length === 0;
	}
	/**
	* Resets the summary buffer without writing to summary file
	*
	* @returns {Summary} summary instance
	*/
	emptyBuffer() {
		return this._buffer = "", this;
	}
	/**
	* Adds raw text to the summary buffer
	*
	* @param {string} text content to add
	* @param {boolean} [addEOL=false] (optional) append an EOL to the raw text (default: false)
	*
	* @returns {Summary} summary instance
	*/
	addRaw(text, addEOL = !1) {
		return this._buffer += text, addEOL ? this.addEOL() : this;
	}
	/**
	* Adds the operating system-specific end-of-line marker to the buffer
	*
	* @returns {Summary} summary instance
	*/
	addEOL() {
		return this.addRaw(os.EOL);
	}
	/**
	* Adds an HTML codeblock to the summary buffer
	*
	* @param {string} code content to render within fenced code block
	* @param {string} lang (optional) language to syntax highlight code
	*
	* @returns {Summary} summary instance
	*/
	addCodeBlock(code, lang) {
		let attrs = Object.assign({}, lang && { lang }), element = this.wrap("pre", this.wrap("code", code), attrs);
		return this.addRaw(element).addEOL();
	}
	/**
	* Adds an HTML list to the summary buffer
	*
	* @param {string[]} items list of items to render
	* @param {boolean} [ordered=false] (optional) if the rendered list should be ordered or not (default: false)
	*
	* @returns {Summary} summary instance
	*/
	addList(items, ordered = !1) {
		let tag = ordered ? "ol" : "ul", listItems = items.map((item) => this.wrap("li", item)).join(""), element = this.wrap(tag, listItems);
		return this.addRaw(element).addEOL();
	}
	/**
	* Adds an HTML table to the summary buffer
	*
	* @param {SummaryTableCell[]} rows table rows
	*
	* @returns {Summary} summary instance
	*/
	addTable(rows) {
		let tableBody = rows.map((row) => {
			let cells = row.map((cell) => {
				if (typeof cell == "string") return this.wrap("td", cell);
				let { header, data, colspan, rowspan } = cell, tag = header ? "th" : "td", attrs = Object.assign(Object.assign({}, colspan && { colspan }), rowspan && { rowspan });
				return this.wrap(tag, data, attrs);
			}).join("");
			return this.wrap("tr", cells);
		}).join(""), element = this.wrap("table", tableBody);
		return this.addRaw(element).addEOL();
	}
	/**
	* Adds a collapsable HTML details element to the summary buffer
	*
	* @param {string} label text for the closed state
	* @param {string} content collapsable content
	*
	* @returns {Summary} summary instance
	*/
	addDetails(label, content) {
		let element = this.wrap("details", this.wrap("summary", label) + content);
		return this.addRaw(element).addEOL();
	}
	/**
	* Adds an HTML image tag to the summary buffer
	*
	* @param {string} src path to the image you to embed
	* @param {string} alt text description of the image
	* @param {SummaryImageOptions} options (optional) addition image attributes
	*
	* @returns {Summary} summary instance
	*/
	addImage(src, alt, options) {
		let { width, height } = options || {}, attrs = Object.assign(Object.assign({}, width && { width }), height && { height }), element = this.wrap("img", null, Object.assign({
			src,
			alt
		}, attrs));
		return this.addRaw(element).addEOL();
	}
	/**
	* Adds an HTML section heading element
	*
	* @param {string} text heading text
	* @param {number | string} [level=1] (optional) the heading level, default: 1
	*
	* @returns {Summary} summary instance
	*/
	addHeading(text, level) {
		let tag = `h${level}`, allowedTag = [
			"h1",
			"h2",
			"h3",
			"h4",
			"h5",
			"h6"
		].includes(tag) ? tag : "h1", element = this.wrap(allowedTag, text);
		return this.addRaw(element).addEOL();
	}
	/**
	* Adds an HTML thematic break (<hr>) to the summary buffer
	*
	* @returns {Summary} summary instance
	*/
	addSeparator() {
		let element = this.wrap("hr", null);
		return this.addRaw(element).addEOL();
	}
	/**
	* Adds an HTML line break (<br>) to the summary buffer
	*
	* @returns {Summary} summary instance
	*/
	addBreak() {
		let element = this.wrap("br", null);
		return this.addRaw(element).addEOL();
	}
	/**
	* Adds an HTML blockquote to the summary buffer
	*
	* @param {string} text quote text
	* @param {string} cite (optional) citation url
	*
	* @returns {Summary} summary instance
	*/
	addQuote(text, cite) {
		let attrs = Object.assign({}, cite && { cite }), element = this.wrap("blockquote", text, attrs);
		return this.addRaw(element).addEOL();
	}
	/**
	* Adds an HTML anchor tag to the summary buffer
	*
	* @param {string} text link text/content
	* @param {string} href hyperlink
	*
	* @returns {Summary} summary instance
	*/
	addLink(text, href) {
		let element = this.wrap("a", text, { href });
		return this.addRaw(element).addEOL();
	}
}();
//#endregion
//#region node_modules/.pnpm/@actions+io@3.0.2/node_modules/@actions/io/lib/io-util.js
var __awaiter$5 = function(thisArg, _arguments, P, generator) {
	function adopt(value) {
		return value instanceof P ? value : new P(function(resolve) {
			resolve(value);
		});
	}
	return new (P ||= Promise)(function(resolve, reject) {
		function fulfilled(value) {
			try {
				step(generator.next(value));
			} catch (e) {
				reject(e);
			}
		}
		function rejected(value) {
			try {
				step(generator.throw(value));
			} catch (e) {
				reject(e);
			}
		}
		function step(result) {
			result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
		}
		step((generator = generator.apply(thisArg, _arguments || [])).next());
	});
};
const { chmod, copyFile, lstat, mkdir, open, readdir, rename, rm, rmdir, stat, symlink, unlink } = fs.promises, IS_WINDOWS$1 = process.platform === "win32";
fs.constants.O_RDONLY;
/**
* On OSX/Linux, true if path starts with '/'. On Windows, true for paths like:
* \, \hello, \\hello\share, C:, and C:\hello (and corresponding alternate separator cases).
*/
function isRooted(p) {
	if (p = normalizeSeparators(p), !p) throw Error("isRooted() parameter \"p\" cannot be empty");
	return IS_WINDOWS$1 ? p.startsWith("\\") || /^[A-Z]:/i.test(p) : p.startsWith("/");
}
/**
* Best effort attempt to determine whether a file exists and is executable.
* @param filePath    file path to check
* @param extensions  additional file extensions to try
* @return if file exists and is executable, returns the file path. otherwise empty string.
*/
function tryGetExecutablePath(filePath, extensions) {
	return __awaiter$5(this, void 0, void 0, function* () {
		let stats;
		try {
			stats = yield stat(filePath);
		} catch (err) {
			err.code !== "ENOENT" && console.log(`Unexpected error attempting to determine if executable file exists '${filePath}': ${err}`);
		}
		if (stats && stats.isFile()) {
			if (IS_WINDOWS$1) {
				let upperExt = path.extname(filePath).toUpperCase();
				if (extensions.some((validExt) => validExt.toUpperCase() === upperExt)) return filePath;
			} else if (isUnixExecutable(stats)) return filePath;
		}
		let originalFilePath = filePath;
		for (let extension of extensions) {
			filePath = originalFilePath + extension, stats = void 0;
			try {
				stats = yield stat(filePath);
			} catch (err) {
				err.code !== "ENOENT" && console.log(`Unexpected error attempting to determine if executable file exists '${filePath}': ${err}`);
			}
			if (stats && stats.isFile()) {
				if (IS_WINDOWS$1) {
					try {
						let directory = path.dirname(filePath), upperName = path.basename(filePath).toUpperCase();
						for (let actualName of yield readdir(directory)) if (upperName === actualName.toUpperCase()) {
							filePath = path.join(directory, actualName);
							break;
						}
					} catch (err) {
						console.log(`Unexpected error attempting to determine the actual case of the file '${filePath}': ${err}`);
					}
					return filePath;
				} else if (isUnixExecutable(stats)) return filePath;
			}
		}
		return "";
	});
}
function normalizeSeparators(p) {
	return p ||= "", IS_WINDOWS$1 ? (p = p.replace(/\//g, "\\"), p.replace(/\\\\+/g, "\\")) : p.replace(/\/\/+/g, "/");
}
function isUnixExecutable(stats) {
	return (stats.mode & 1) > 0 || (stats.mode & 8) > 0 && process.getgid !== void 0 && stats.gid === process.getgid() || (stats.mode & 64) > 0 && process.getuid !== void 0 && stats.uid === process.getuid();
}
//#endregion
//#region node_modules/.pnpm/@actions+io@3.0.2/node_modules/@actions/io/lib/io.js
var __awaiter$4 = function(thisArg, _arguments, P, generator) {
	function adopt(value) {
		return value instanceof P ? value : new P(function(resolve) {
			resolve(value);
		});
	}
	return new (P ||= Promise)(function(resolve, reject) {
		function fulfilled(value) {
			try {
				step(generator.next(value));
			} catch (e) {
				reject(e);
			}
		}
		function rejected(value) {
			try {
				step(generator.throw(value));
			} catch (e) {
				reject(e);
			}
		}
		function step(result) {
			result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
		}
		step((generator = generator.apply(thisArg, _arguments || [])).next());
	});
};
/**
* Returns path of a tool had the tool actually been invoked.  Resolves via paths.
* If you check and the tool does not exist, it will throw.
*
* @param     tool              name of the tool
* @param     check             whether to check if tool exists
* @returns   Promise<string>   path to tool
*/
function which(tool, check) {
	return __awaiter$4(this, void 0, void 0, function* () {
		if (!tool) throw Error("parameter 'tool' is required");
		if (check) {
			let result = yield which(tool, !1);
			if (!result) throw Error(IS_WINDOWS$1 ? `Unable to locate executable file: ${tool}. Please verify either the file path exists or the file can be found within a directory specified by the PATH environment variable. Also verify the file has a valid extension for an executable file.` : `Unable to locate executable file: ${tool}. Please verify either the file path exists or the file can be found within a directory specified by the PATH environment variable. Also check the file mode to verify the file is executable.`);
			return result;
		}
		let matches = yield findInPath(tool);
		return matches && matches.length > 0 ? matches[0] : "";
	});
}
/**
* Returns a list of all occurrences of the given tool on the system path.
*
* @returns   Promise<string[]>  the paths of the tool
*/
function findInPath(tool) {
	return __awaiter$4(this, void 0, void 0, function* () {
		if (!tool) throw Error("parameter 'tool' is required");
		let extensions = [];
		if (IS_WINDOWS$1 && process.env.PATHEXT) for (let extension of process.env.PATHEXT.split(path.delimiter)) extension && extensions.push(extension);
		if (isRooted(tool)) {
			let filePath = yield tryGetExecutablePath(tool, extensions);
			return filePath ? [filePath] : [];
		}
		if (tool.includes(path.sep)) return [];
		let directories = [];
		if (process.env.PATH) for (let p of process.env.PATH.split(path.delimiter)) p && directories.push(p);
		let matches = [];
		for (let directory of directories) {
			let filePath = yield tryGetExecutablePath(path.join(directory, tool), extensions);
			filePath && matches.push(filePath);
		}
		return matches;
	});
}
process.platform, events.EventEmitter, events.EventEmitter, os.default.platform(), os.default.arch();
/**
* The code to exit an action
*/
var ExitCode;
(function(ExitCode) {
	/**
	* A code indicating that the action was a failure
	*/
	ExitCode[ExitCode.Success = 0] = "Success", ExitCode[ExitCode.Failure = 1] = "Failure";
})(ExitCode ||= {});
/**
* Gets the value of an input.
* Unless trimWhitespace is set to false in InputOptions, the value is also trimmed.
* Returns an empty string if the value is not defined.
*
* @param     name     name of the input to get
* @param     options  optional. See InputOptions.
* @returns   string
*/
function getInput(name, options) {
	let val = process.env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`] || "";
	if (options && options.required && !val) throw Error(`Input required and not supplied: ${name}`);
	return options && options.trimWhitespace === !1 ? val : val.trim();
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
//#region core/lib/docker/compose-project-name.ts
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
/** Compose project name for a builder_name, preferring an explicit override
*  over the deterministic hash-derived name. */
function resolveProjectName(builderName, composeProjectNameOverride) {
	return composeProjectNameOverride || deriveProjectName(builderName);
}
//#endregion
//#region core/lib/docker/args.ts
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
//#region core/lib/errors.ts
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
async function main() {
	let builderName = getInput("builder_name") || "buildcage", projectName = resolveProjectName(builderName, void 0), docker = createDocker(), containerId;
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
process.argv[1] === (0, node_url.fileURLToPath)(require("url").pathToFileURL(__filename).href) && main().catch((err) => {
	err instanceof ActionError ? console.log(`::error::${err.message}`) : console.log(`::error::Unexpected error in report: ${errorMessage(err)}`), process.exit(1);
});
//#endregion

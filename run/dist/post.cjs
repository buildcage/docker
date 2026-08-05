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
let node_child_process = require("node:child_process"), node_fs = require("node:fs"), node_path = require("node:path"), node_url = require("node:url"), os = require("os");
os = __toESM(os, 1);
let fs = require("fs");
fs = __toESM(fs, 1);
let path = require("path");
path = __toESM(path, 1);
let events = require("events");
events = __toESM(events, 1);
let child_process = require("child_process");
child_process = __toESM(child_process, 1), require("timers");
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
* Gets the value of an state set by this action's main execution.
*
* @param     name     name of the state to get
* @returns   string
*/
function getState(name) {
	return process.env[`STATE_${name}`] || "";
}
//#endregion
//#region core/lib/docker/args.ts
/** Build the `docker compose ... down` argv — see buildComposeUpArgs above. */
function buildComposeDownArgs({ composeFile, projectName }) {
	return [
		"compose",
		"-f",
		composeFile,
		"-p",
		projectName,
		"down"
	];
}
//#endregion
//#region core/lib/errors.ts
/**
* Safely extract a message from a caught value of unknown shape — a plain
* `Error` most of the time, but `catch` doesn't guarantee that.
*/
function errorMessage(e) {
	return e instanceof Error ? e.message : String(e);
}
//#endregion
//#region run/src/lib/sandbox/mountinfo.ts
/**
* Pure: extract {mountPoint, fsType} for every line of raw
* /proc/self/mountinfo content. Format (space-separated fields):
*   ID PARENT-ID MAJOR:MINOR ROOT MOUNT-POINT OPTIONS [OPT-FIELDS...] - FSTYPE SOURCE SUPER-OPTIONS
* The mount point is always field 5 (index 4); the filesystem type is
* always the field right after the literal "-" separator, regardless of
* how many optional fields precede it.
*/
function parseMountinfo(mountinfoContent) {
	return mountinfoContent.split("\n").filter(Boolean).map((line) => {
		let fields = line.split(" "), dashIndex = fields.indexOf("-");
		return {
			mountPoint: fields[4],
			fsType: fields[dashIndex + 1]
		};
	});
}
/**
* Pure: mount points from raw /proc/self/mountinfo content that are
* nested under `dir` (including `dir` itself), deepest-path-first so a
* caller can safely unmount children before their parents.
*/
function parseMountsUnder(mountinfoContent, dir) {
	let prefix = dir.endsWith("/") ? dir : `${dir}/`;
	return parseMountinfo(mountinfoContent).map(({ mountPoint }) => mountPoint).filter((mountPoint) => mountPoint === dir || mountPoint.startsWith(prefix)).sort((a, b) => b.length - a.length);
}
/**
* Force-detaches any mount points still nested under `dir` before it's
* recursively deleted. This is the safety net for rootfsBindDir (a
* `mount --rbind /` of the entire host filesystem — see main.ts) surviving
* past run-isolated.sh's own cleanup trap: if that trap never runs (e.g.
* run-isolated.sh itself is SIGKILL'd, which bypasses traps entirely) or
* its `umount -R` fails (EBUSY), a plain recursive delete of `dir` would
* otherwise walk straight through the still-live bind-mount and delete
* the real files on the host it points at, not a sandboxed copy. `-l`
* (lazy) detaches each mount from the namespace immediately regardless of
* busy references, so this step itself can't hang or fail the way a
* normal (non-lazy) unmount could.
*/
function unmountAllUnder(dir) {
	let mountPoints;
	try {
		mountPoints = parseMountsUnder((0, node_fs.readFileSync)("/proc/self/mountinfo", "utf8"), dir);
	} catch {
		return;
	}
	for (let mountPoint of mountPoints) try {
		(0, node_child_process.execFileSync)("sudo", [
			"umount",
			"-R",
			"-l",
			mountPoint
		], { stdio: [
			"ignore",
			"ignore",
			"pipe"
		] });
	} catch (e) {
		console.log(`::warning::Failed to unmount ${mountPoint} before cleanup: ${errorMessage(e)}`);
	}
}
/**
* Removes the scratch dir, retrying on EBUSY. A lazy unmount (see
* unmountAllUnder) detaches a mount from the path-resolution tree
* immediately -- it stops appearing in /proc/self/mountinfo right away --
* but the kernel's underlying teardown of that now-orphaned mount can
* still lag behind by a short, bounded window, which can make a
* directory rmSync is about to delete spuriously report EBUSY even
* though it's no longer listed as a mountpoint at all. Resolves on the
* very next attempt after a brief wait.
*/
function removeScratchDir(dir) {
	for (let attempt = 1; attempt <= 5; attempt++) try {
		(0, node_fs.rmSync)(dir, {
			recursive: !0,
			force: !0
		});
		return;
	} catch (e) {
		if (e.code !== "EBUSY" || attempt === 5) throw e;
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
	}
}
/**
* Force-detach anything still mounted under `dir` (the rootfs bind-mount
* safety net — see unmountAllUnder) and then recursively remove it. Exported
* so post.ts can reclaim a scratch dir orphaned by a hard kill that bypassed
* withScratchDir's own finally. No-ops safely when `dir` doesn't exist.
*/
function cleanupScratchDir(dir) {
	unmountAllUnder(dir), removeScratchDir(dir);
}
/**
* Absolute path of the scratch dir for a given proxy container, derived
* deterministically from `containerName` (the `buildcage-proxy-` prefix
* swapped for `sandbox-`, under SANDBOX_SCRATCH_BASE). Lets the post step
* reconstruct and reclaim the exact same directory from `STATE_container_name`
* alone.
*/
function scratchDirFor(containerName) {
	return (0, node_path.join)("/var/tmp/buildcage", containerName.replace(/^buildcage-proxy-/, "sandbox-"));
}
//#endregion
//#region run/src/post.ts
const __dirname$1 = (0, node_path.dirname)((0, node_url.fileURLToPath)(require("url").pathToFileURL(__filename).href)), containerName = getState("container_name"), projectName = getState("project_name");
if (containerName.startsWith("buildcage-proxy-")) try {
	let scratchDir = scratchDirFor(containerName);
	(0, node_fs.existsSync)(scratchDir) && cleanupScratchDir(scratchDir);
} catch (e) {
	console.log(`::warning::run post-cleanup: failed to remove sandbox scratch dir: ${errorMessage(e)}`);
}
containerName && projectName ? (0, node_child_process.execFileSync)("docker", buildComposeDownArgs({
	composeFile: (0, node_path.join)(__dirname$1, "../compose.yaml"),
	projectName
}), {
	stdio: "inherit",
	env: {
		...process.env,
		PROXY_CONTAINER_NAME: containerName
	}
}) : containerName && console.log(`::warning::run post-cleanup: container_name is set but project_name is missing from GITHUB_STATE; skipping cleanup to avoid targeting Compose's implicit, shared project name. Container ${containerName} may need manual removal.`);
//#endregion

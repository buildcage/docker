//#region \0rolldown/runtime.js
var __create = Object.create, __defProp = Object.defineProperty, __getOwnPropDesc = Object.getOwnPropertyDescriptor, __getOwnPropNames = Object.getOwnPropertyNames, __getProtoOf = Object.getPrototypeOf, __hasOwnProp = Object.prototype.hasOwnProperty, __copyProps = (to, from, except, desc) => {
	if (from && typeof from == "object" || typeof from == "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) key = keys[i], !__hasOwnProp.call(to, key) && key !== except && __defProp(to, key, {
		get: ((k) => from[k]).bind(null, key),
		enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
	});
	return to;
}, __toESM = (mod, isNodeMode, target) => (target = mod == null ? {} : __create(__getProtoOf(mod)), __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
	value: mod,
	enumerable: !0
}) : target, mod));
//#endregion
let node_child_process = require("node:child_process"), node_path = require("node:path"), node_url = require("node:url"), os = require("os");
os = __toESM(os, 1);
let fs = require("fs");
fs = __toESM(fs, 1);
let path = require("path");
path = __toESM(path, 1);
let events = require("events");
events = __toESM(events, 1);
let node_crypto = require("node:crypto"), child_process = require("child_process");
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
	wrap(tag, content, attrs = {}) {
		let htmlAttrs = Object.entries(attrs).map(([key, value]) => ` ${key}="${value}"`).join("");
		return content ? `<${tag}${htmlAttrs}>${content}</${tag}>` : `<${tag}${htmlAttrs}>`;
	}
	write(options) {
		return __awaiter$6(this, void 0, void 0, function* () {
			let overwrite = !!options?.overwrite, filePath = yield this.filePath();
			return yield (overwrite ? writeFile : appendFile)(filePath, this._buffer, { encoding: "utf8" }), this.emptyBuffer();
		});
	}
	clear() {
		return __awaiter$6(this, void 0, void 0, function* () {
			return this.emptyBuffer().write({ overwrite: !0 });
		});
	}
	stringify() {
		return this._buffer;
	}
	isEmptyBuffer() {
		return this._buffer.length === 0;
	}
	emptyBuffer() {
		return this._buffer = "", this;
	}
	addRaw(text, addEOL = !1) {
		return this._buffer += text, addEOL ? this.addEOL() : this;
	}
	addEOL() {
		return this.addRaw(os.EOL);
	}
	addCodeBlock(code, lang) {
		let attrs = Object.assign({}, lang && { lang }), element = this.wrap("pre", this.wrap("code", code), attrs);
		return this.addRaw(element).addEOL();
	}
	addList(items, ordered = !1) {
		let tag = ordered ? "ol" : "ul", listItems = items.map((item) => this.wrap("li", item)).join(""), element = this.wrap(tag, listItems);
		return this.addRaw(element).addEOL();
	}
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
	addDetails(label, content) {
		let element = this.wrap("details", this.wrap("summary", label) + content);
		return this.addRaw(element).addEOL();
	}
	addImage(src, alt, options) {
		let { width, height } = options || {}, attrs = Object.assign(Object.assign({}, width && { width }), height && { height }), element = this.wrap("img", null, Object.assign({
			src,
			alt
		}, attrs));
		return this.addRaw(element).addEOL();
	}
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
	addSeparator() {
		let element = this.wrap("hr", null);
		return this.addRaw(element).addEOL();
	}
	addBreak() {
		let element = this.wrap("br", null);
		return this.addRaw(element).addEOL();
	}
	addQuote(text, cite) {
		let attrs = Object.assign({}, cite && { cite }), element = this.wrap("blockquote", text, attrs);
		return this.addRaw(element).addEOL();
	}
	addLink(text, href) {
		let element = this.wrap("a", text, { href });
		return this.addRaw(element).addEOL();
	}
}();
const { chmod, copyFile, lstat, mkdir, open, readdir, rename, rm, rmdir, stat, symlink, unlink } = fs.promises;
process.platform, fs.constants.O_RDONLY, process.platform, events.EventEmitter, events.EventEmitter, os.default.platform(), os.default.arch();
var ExitCode;
(function(ExitCode) {
	ExitCode[ExitCode.Success = 0] = "Success", ExitCode[ExitCode.Failure = 1] = "Failure";
})(ExitCode ||= {});
function getInput(name, options) {
	let val = process.env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`] || "";
	if (options && options.required && !val) throw Error(`Input required and not supplied: ${name}`);
	return options && options.trimWhitespace === !1 ? val : val.trim();
}
function info(message) {
	process.stdout.write(message + os.EOL);
}
function getState(name) {
	return process.env[`STATE_${name}`] || "";
}
//#endregion
//#region src/core/lib/docker/args.ts
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
//#region src/core/lib/docker/compose-project-name.ts
function deriveProjectName(containerName) {
	return `buildcage-${(0, node_crypto.createHash)("sha256").update(containerName).digest("hex").slice(0, 12)}`;
}
function resolveProjectName(builderName, composeProjectNameOverride) {
	return composeProjectNameOverride || deriveProjectName(builderName);
}
//#endregion
//#region src/core/lib/acl/ipv4.ts
const OCTET = "(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])", PREFIX = "(3[0-2]|[12]?[0-9])", IPV4 = `${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}`;
RegExp(`^${OCTET}$`), RegExp(`^${IPV4}(?:/${PREFIX})?$`), RegExp(`^${IPV4}/${PREFIX}$`);
//#endregion
//#region src/lib/inputs.ts
function readBuilderName(getInput$3 = getInput) {
	return getInput$3("builder_name") || "buildcage";
}
function planPostCleanup(composeFile, projectNameOverride, env, { savedBuilderName, getInput: getInput$1 = getInput } = {}) {
	if (!savedBuilderName && getInput$1("config_file")) return;
	let builderName = savedBuilderName || readBuilderName(getInput$1);
	return {
		args: buildComposeDownArgs({
			composeFile,
			projectName: resolveProjectName(builderName, projectNameOverride)
		}),
		env: {
			...env,
			BUILDER_NAME: builderName
		}
	};
}
//#endregion
//#region src/post.ts
const __dirname$1 = (0, node_path.dirname)((0, node_url.fileURLToPath)(require("url").pathToFileURL(__filename).href));
function main() {
	let plan = planPostCleanup((0, node_path.join)(__dirname$1, "../docker/compose.action.yaml"), void 0, process.env, { savedBuilderName: getState("builder_name") });
	if (!plan) {
		info("No builder to remove: the setup step stopped before it named one.");
		return;
	}
	(0, node_child_process.execFileSync)("docker", plan.args, {
		stdio: "inherit",
		env: plan.env
	});
}
process.argv[1] === (0, node_url.fileURLToPath)(require("url").pathToFileURL(__filename).href) && main();
//#endregion

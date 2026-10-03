//#region \0rolldown/runtime.js
var __create = Object.create, __defProp = Object.defineProperty, __getOwnPropDesc = Object.getOwnPropertyDescriptor, __getOwnPropNames = Object.getOwnPropertyNames, __getProtoOf = Object.getPrototypeOf, __hasOwnProp = Object.prototype.hasOwnProperty, __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports), __copyProps = (to, from, except, desc) => {
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
let node_url = require("node:url"), node_child_process = require("node:child_process"), node_path = require("node:path");
node_path = __toESM(node_path, 1);
let os = require("os");
os = __toESM(os, 1);
let crypto$1 = require("crypto");
crypto$1 = __toESM(crypto$1, 1);
let fs = require("fs");
fs = __toESM(fs, 1);
let path = require("path");
path = __toESM(path, 1);
let events = require("events");
events = __toESM(events, 1);
let node_crypto = require("node:crypto"), child_process = require("child_process");
child_process = __toESM(child_process, 1), require("timers");
let node_fs = require("node:fs"), node_os = require("node:os");
node_os = __toESM(node_os, 1);
let node_fs_promises = require("node:fs/promises");
//#region src/core/lib/errors.ts
var ActionError = class extends Error {
	code;
	constructor(message, code) {
		super(message), this.name = new.target.name, this.code = code;
	}
};
function errorMessage(e) {
	return e instanceof Error ? e.message : String(e);
}
//#endregion
//#region src/core/lib/actions/annotation.ts
function escapeData$1(message) {
	return message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
function createAnnotation(enabled) {
	return enabled ? {
		notice(message) {
			console.log(`::notice::${escapeData$1(message)}`);
		},
		warning(message) {
			console.log(`::warning::${escapeData$1(message)}`);
		},
		error(message) {
			console.log(`::error::${escapeData$1(message)}`);
		}
	} : {
		notice() {},
		warning() {},
		error() {}
	};
}
const annotate = createAnnotation(!0);
//#endregion
//#region src/core/lib/actions/fatal.ts
function exitOnFatalError(context) {
	return (err) => {
		err instanceof ActionError ? annotate.error(err.message) : annotate.error(`Unexpected error in ${context}: ${errorMessage(err)}`), process.exit(1);
	};
}
//#endregion
//#region node_modules/.pnpm/@actions+core@3.0.1/node_modules/@actions/core/lib/utils.js
function toCommandValue(input) {
	return input == null ? "" : typeof input == "string" || input instanceof String ? input : JSON.stringify(input);
}
//#endregion
//#region node_modules/.pnpm/@actions+core@3.0.1/node_modules/@actions/core/lib/command.js
function issueCommand(command, properties, message) {
	let cmd = new Command(command, properties, message);
	process.stdout.write(cmd.toString() + os.EOL);
}
var Command = class {
	constructor(command, properties, message) {
		command ||= "missing.command", this.command = command, this.properties = properties, this.message = message;
	}
	toString() {
		let cmdStr = "::" + this.command;
		if (this.properties && Object.keys(this.properties).length > 0) {
			cmdStr += " ";
			let first = !0;
			for (let key in this.properties) if (this.properties.hasOwnProperty(key)) {
				let val = this.properties[key];
				val && (first ? first = !1 : cmdStr += ",", cmdStr += `${key}=${escapeProperty(val)}`);
			}
		}
		return cmdStr += `::${escapeData(this.message)}`, cmdStr;
	}
};
function escapeData(s) {
	return toCommandValue(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
function escapeProperty(s) {
	return toCommandValue(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A").replace(/:/g, "%3A").replace(/,/g, "%2C");
}
//#endregion
//#region node_modules/.pnpm/@actions+core@3.0.1/node_modules/@actions/core/lib/file-command.js
function issueFileCommand(command, message) {
	let filePath = process.env[`GITHUB_${command}`];
	if (!filePath) throw Error(`Unable to find environment variable for file command ${command}`);
	if (!fs.existsSync(filePath)) throw Error(`Missing file at path: ${filePath}`);
	fs.appendFileSync(filePath, `${toCommandValue(message)}${os.EOL}`, { encoding: "utf8" });
}
function prepareKeyValueMessage(key, value) {
	let delimiter = `ghadelimiter_${crypto$1.randomUUID()}`, convertedValue = toCommandValue(value);
	if (key.includes(delimiter)) throw Error(`Unexpected input: name should not contain the delimiter "${delimiter}"`);
	if (convertedValue.includes(delimiter)) throw Error(`Unexpected input: value should not contain the delimiter "${delimiter}"`);
	return `${key}<<${delimiter}${os.EOL}${convertedValue}${os.EOL}${delimiter}`;
}
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
const { chmod, copyFile, lstat, mkdir, open, readdir, rename, rm: rm$1, rmdir, stat, symlink, unlink } = fs.promises;
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
function saveState(name, value) {
	if (process.env.GITHUB_STATE) return issueFileCommand("STATE", prepareKeyValueMessage(name, value));
	issueCommand("save-state", { name }, toCommandValue(value));
}
//#endregion
//#region src/core/lib/line-comments.ts
function stripLineComment(line) {
	return line.replace(/(^|\s)#.*$/, "$1");
}
function rejectGluedHash(rule) {
	if (rule.includes("#")) throw Error(`Invalid rule ${JSON.stringify(rule)}: a "#" starts a comment only with a space before it, and "#" is never part of a host or URL, so a rule cannot contain one.`);
}
//#endregion
//#region src/core/lib/acl/ipv4.ts
const OCTET = "(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])", PREFIX = "(3[0-2]|[12]?[0-9])", IPV4 = `${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}`, OCTET_RE = RegExp(`^${OCTET}$`), IPV4_OR_CIDR = RegExp(`^${IPV4}(?:/${PREFIX})?$`), IPV4_CIDR = RegExp(`^${IPV4}/${PREFIX}$`);
function isIpRuleAddress(host) {
	if (!/[*?]/.test(host)) return IPV4_OR_CIDR.test(host);
	let octets = host.split(".");
	return octets.length > 4 || octets.length < 4 && !host.includes("**") ? !1 : octets.every((octet) => /[*?]/.test(octet) || OCTET_RE.test(octet));
}
//#endregion
//#region src/core/lib/acl/partial-wildcard.ts
const REGEX_META = /[.+^$()[\]{}|\\]/g, DOMAIN = {
	across: ".+",
	within: "[^.]+",
	single: "[^.]"
}, PATH = {
	across: ".*",
	within: "[^/]+",
	single: "[^/]"
};
function atomToRegex(atom, vocab) {
	let out = "";
	for (let i = 0; i < atom.length; i++) {
		if (atom[i] === "*") {
			atom[i + 1] === "*" ? (out += vocab.across, i++) : out += vocab.within;
			continue;
		}
		if (atom[i] === "?") {
			out += vocab.single;
			continue;
		}
		out += atom[i].replace(REGEX_META, "\\$&");
	}
	return out;
}
const HOST_LABEL = /^[A-Za-z0-9_*?-]+$/;
function checkHostLabel(label, domain) {
	if (label === "") throw Error(`Invalid domain "${domain}": empty label (a leading, trailing or doubled dot)`);
	if (!HOST_LABEL.test(label)) throw /[\u0080-￿]/.test(label) ? Error(`Invalid domain "${domain}": "${label}" is not ASCII. A connection names an internationalized domain in its punycode form, so write that instead (xn--...)`) : Error(`Invalid domain "${domain}": "${label}" holds a character no hostname can; a label is letters, digits, "-" and "_", with the wildcards "*" and "?"`);
}
function domainToRegexPartial(domain) {
	return domain.split(".").map((label) => (checkHostLabel(label, domain), atomToRegex(label, DOMAIN))).join("\\.");
}
function pathToRegexPartial(path) {
	return path === "" ? "" : path.split("/").map((segment) => atomToRegex(segment, PATH)).join("/");
}
function checkPort(port, rule) {
	if (!(port === "*" || /^[1-9]\d{0,4}$/.test(port) && Number(port) <= 65535)) throw Error(`Invalid port in rule "${rule}": "${port}". Write a decimal from 1 to 65535 without a leading zero (443, not 0443), or "*" for any port`);
}
function wildcardToRegexPartial(pattern) {
	if (!/^[^:]+:(?:\d+|\*)$/.test(pattern)) throw Error(`Invalid pattern "${pattern}"`);
	let colonIndex = pattern.lastIndexOf(":"), domain = pattern.slice(0, colonIndex), port = pattern.slice(colonIndex + 1);
	return `${domainToRegexPartial(domain)}:${port === "*" ? "\\d+" : port}`;
}
function* regexChars(regex) {
	let inClass = !1;
	for (let i = 0; i < regex.length; i++) {
		let c = regex[i];
		yield [i, inClass], c === "\\" ? i++ : inClass ? c === "]" && (inClass = !1) : c === "[" && (inClass = !0);
	}
}
function hasTopLevelAlternation(regex) {
	let depth = 0;
	for (let [i, inClass] of regexChars(regex)) {
		if (inClass) continue;
		let c = regex[i];
		if (c === "(") depth++;
		else if (c === ")") depth--;
		else if (c === "|" && depth === 0) return !0;
	}
	return !1;
}
const NAMED_GROUP = /^\(\?<(?![=!])([^>]*)>/;
function capturingGroups(regex) {
	let count = 0;
	for (let [i, inClass] of regexChars(regex)) {
		if (inClass) continue;
		let rest = regex.slice(i);
		(/^\((?!\?)/.test(rest) || NAMED_GROUP.test(rest)) && count++;
	}
	return count;
}
const HOST_LITERAL_ILLEGAL = /\\[[\]]/, COREFILE_UNSAFE = /['`]|\{[$%]/, RE2_UNSUPPORTED = /^(?:\(\?<?[=!]|\\[1-9])/;
function checkResolverRegexSyntax(text, label, rule) {
	for (let [i, inClass] of regexChars(text)) {
		if (inClass) continue;
		let unsupported = RE2_UNSUPPORTED.exec(text.slice(i));
		if (unsupported) throw Error(`Invalid regex in rule "${rule}": the ${label} "${text}" uses "${unsupported[0]}". Lookaround and backreferences are not supported in a host pattern, which the resolver matches with RE2`);
	}
}
const POSIX_BRACKET = /^\[([:.=])(?:\\(?:[\\\]]|(?![\\\]]))|\[(?!\1)|[^\]\\[])*?\1\]/;
function checkClasses(text, label, rule) {
	for (let [i, inClass] of regexChars(text)) {
		if (text[i] !== "[") continue;
		let rest = text.slice(i), clash = POSIX_BRACKET.exec(rest) ?? (inClass ? null : /^\[\^?\]/.exec(rest));
		if (clash) throw Error(`Invalid regex in rule "${rule}": the ${label} "${text}" has the character class syntax "${clash[0]}", which the proxy's PCRE2 reads differently from setup. Escape a "]" inside a class ("\\]"), and spell a POSIX class as a range ("[a-z]")`);
	}
}
const PORTABLE_ESCAPE = /^(?:[dDwWsSbBnrtf]|[1-9](?!\d))/;
function checkPortableEscape(text, rest, inClass, groups, label, rule) {
	if (inClass && rest[0] === "B") throw Error(`Invalid regex in rule "${rule}": the ${label} "${text}" uses "\\B" in a character class, which the proxy's PCRE2 refuses`);
	if (!inClass && Number(rest[0]) > groups) throw Error(`Invalid regex in rule "${rule}": the ${label} "${text}" uses "\\${rest[0]}" but has ${groups} capturing group${groups === 1 ? "" : "s"}`);
}
function checkEscapes(text, label, rule) {
	let groups = capturingGroups(text);
	for (let [i, inClass] of regexChars(text)) {
		if (text[i] !== "\\") continue;
		let rest = text.slice(i + 1);
		if (PORTABLE_ESCAPE.test(rest)) {
			checkPortableEscape(text, rest, inClass, groups, label, rule);
			continue;
		}
		let escape = /^(?:\d+|[A-Za-z])/.exec(rest);
		if (escape) throw Error(`Invalid regex in rule "${rule}": the ${label} "${text}" uses "\\${escape[0]}". The proxy's PCRE2 reads it differently from setup, so a backslash may precede only punctuation, one of \\d \\D \\w \\W \\s \\S \\b \\B \\n \\r \\t \\f, or a single backreference digit`);
	}
}
function checkGroups(text, label, rule) {
	let names = new Set();
	for (let [i, inClass] of regexChars(text)) {
		if (inClass) continue;
		let rest = text.slice(i), opening = /^\(\?(?![:=!<])[^:)]*:?/.exec(rest);
		if (opening) throw Error(`Invalid regex in rule "${rule}": the ${label} "${text}" uses "${opening[0]}", which the proxy's QuickJS refuses. A host matches in any case already; in a path, spell each case as a class, as in "[Aa]"`);
		let name = NAMED_GROUP.exec(rest)?.[1];
		if (name !== void 0) {
			if (names.has(name)) throw Error(`Invalid regex in rule "${rule}": the ${label} "${text}" uses the group name "${name}" twice, which the proxy's QuickJS refuses`);
			names.add(name);
		}
	}
}
function checkRawRegexHalf(text, label, rule, hostHalf) {
	if (checkClasses(text, label, rule), checkEscapes(text, label, rule), checkGroups(text, label, rule), hostHalf && checkResolverRegexSyntax(text, label, rule), hasTopLevelAlternation(text)) throw Error(`Invalid regex in rule "${rule}": the ${label} "${text}" has a top-level "|". Anchors bind to its first and last branch rather than to the whole ${label}, so write one rule per alternative, or put the "|" inside a group, as in "(a|b)\\.example\\.com"`);
	if (hostHalf && HOST_LITERAL_ILLEGAL.test(text)) throw Error(`Invalid regex in rule "${rule}": the ${label} "${text}" holds a character no hostname can, so the ":" this rule was split at is not its port separator. An IPv6 address is not supported here, in a "~" rule any more than in a literal one`);
	if (hostHalf && COREFILE_UNSAFE.test(text)) throw Error(`Invalid regex in rule "${rule}": the ${label} "${text}" holds a "'", a backtick, "{$" or "{%". No hostname contains one, and the resolver's config cannot quote it`);
}
function endsAnchored(regex) {
	if (!regex.endsWith("$")) return !1;
	let backslashes = 0;
	for (let i = regex.length - 2; i >= 0 && regex[i] === "\\"; i--) backslashes++;
	return backslashes % 2 == 0;
}
function anchorRawRegex(regex) {
	return `${regex.startsWith("^") ? "" : "^"}${regex}${endsAnchored(regex) ? "" : "$"}`;
}
function portPatternStart(hostPlusPort) {
	let bodyStart = 0;
	for (let [i, inClass] of regexChars(hostPlusPort)) {
		if (inClass || i < bodyStart) continue;
		let c = hostPlusPort[i];
		if (c === ":") return i;
		if (c === "(") {
			if (hostPlusPort[i + 1] === ":") return i;
			hostPlusPort.startsWith("(?:", i) && (bodyStart = i + 3);
		}
	}
	return -1;
}
function splitDomainFromPortPattern(hostPlusPort) {
	let start = portPatternStart(hostPlusPort);
	return start === -1 ? {
		domain: hostPlusPort,
		portPattern: null
	} : {
		domain: hostPlusPort.slice(0, start),
		portPattern: hostPlusPort.slice(start)
	};
}
function splitRawRegexHost(pattern) {
	let regex = pattern.slice(1);
	try {
		new RegExp(regex);
	} catch (e) {
		throw Error(`Invalid regex in rule "${pattern}": ${e.message}`);
	}
	checkRawRegexHalf(regex, "expression", pattern, !1);
	let { domain, portPattern } = splitDomainFromPortPattern(regex);
	if (portPattern === null) throw Error(`Invalid regex in rule "${pattern}": expected ":" separating the host from a port; a port is always required`);
	let host = domain;
	host.startsWith("^") && (host = host.slice(1)), checkRawRegexHalf(host, "host half", pattern, !0);
	try {
		new RegExp(host);
	} catch (e) {
		throw Error(`Invalid regex in rule "${pattern}": the host part "${host}" does not compile on its own: ${e.message}`);
	}
	return { host };
}
//#endregion
//#region src/core/lib/acl/url-rules.ts
const DEFAULT_PORT = {
	https: "443",
	http: "80"
};
function parseMethods(spec, rule) {
	let tokens = spec.split(/[|,]/).map((t) => t.trim()).filter(Boolean);
	if (tokens.length === 0) throw Error(`Invalid rule "${rule}": no method given`);
	if (tokens.includes("*")) return null;
	for (let token of tokens) if (!/^[A-Za-z]+$/.test(token)) throw Error(`Invalid method "${token}" in rule "${rule}"`);
	return [...new Set(tokens.map((t) => t.toUpperCase()))];
}
function splitUrl(url, rule) {
	let match = /^(https?):\/\/([^/]+)(\/.*)?$/.exec(url);
	if (!match) throw Error(`Invalid URL in rule "${rule}": expected http:// or https:// followed by a host`);
	if (url.includes("#")) throw Error(`Invalid URL in rule "${rule}": a "#" fragment is never sent with a request, so this rule would match nothing. Drop it.`);
	return {
		scheme: match[1],
		authority: match[2],
		path: match[3] ?? ""
	};
}
const SLASH_TOKEN = /\\?\//, SCHEME_SEP = /:(?:\\?\/){2}/, RAW_REGEX_SCHEMES = new Map([
	["https", ["https"]],
	["http", ["http"]],
	["https?", ["https", "http"]]
]);
function rawRegexSchemes(prefix, rule) {
	let scheme = prefix.startsWith("^") ? prefix.slice(1) : prefix, schemes = RAW_REGEX_SCHEMES.get(scheme);
	if (!schemes) throw Error(`Invalid regex in rule "${rule}": the scheme "${scheme}" must be written "https", "http" or "https?", so the rule can be matched against the listener a request arrives on`);
	return schemes;
}
function rejectUserinfo(host, rule) {
	if (host.includes("@")) throw Error(`Invalid URL in rule "${rule}": "${host}" holds an "@", but a request's Host never carries a user name, so this rule would match nothing. Drop everything up to the "@".`);
}
function splitRawRegexUrl(regex, rule) {
	checkRawRegexHalf(regex, "expression", rule, !1);
	let schemeSep = SCHEME_SEP.exec(regex);
	if (!schemeSep) throw Error(`Invalid regex in rule "${rule}": expected "://" (or an escaped equivalent like ":\\/\\/ ") separating the scheme from the host, so the host and path can be matched separately`);
	let schemes = rawRegexSchemes(regex.slice(0, schemeSep.index), rule), hostStart = schemeSep.index + schemeSep[0].length, pathSep = SLASH_TOKEN.exec(regex.slice(hostStart));
	if (!pathSep) throw Error(`Invalid regex in rule "${rule}": expected a "/" (or "\\/") after "://" to start the path; a host-only rule belongs in allowed_https_rules instead`);
	let pathStart = hostStart + pathSep.index, hostPart = regex.slice(hostStart, pathStart), pathPart = regex.slice(pathStart);
	checkRawRegexHalf(hostPart, "host half", rule, !1), checkRawRegexHalf(pathPart, "path half", rule, !1), rejectUserinfo(hostPart, rule);
	let { domain: hostOnly } = splitDomainFromPortPattern(hostPart);
	checkRawRegexHalf(hostOnly, "host half", rule, !0);
	let hostRegex = anchorRawRegex(hostPart), authorityRegex = anchorRawRegex(hostOnly), pathRegex = `^${pathPart}`;
	for (let [label, fragment] of [
		["host", hostRegex],
		["host-only", authorityRegex],
		["path", pathRegex]
	]) try {
		new RegExp(fragment);
	} catch (e) {
		throw Error(`Invalid regex in rule "${rule}": the ${label} part "${fragment}" does not compile on its own: ${e.message}`);
	}
	return {
		schemes,
		hostRegex,
		authorityRegex,
		pathRegex
	};
}
function rejectQuery(path, rule) {
	let query = path.indexOf("?");
	if (query !== -1 && /[=&]/.test(path.slice(query))) throw Error(`Invalid URL in rule "${rule}": "${path.slice(query)}" reads as a query string, but a rule matches the path only and a query is never matched. Drop everything from the "?"; a "?" in a path is a single-character wildcard.`);
}
function compileUrl(url, rule) {
	if (url.startsWith("~")) {
		let regex = url.slice(1);
		try {
			new RegExp(regex);
		} catch (e) {
			throw Error(`Invalid regex in rule "${rule}": ${e.message}`);
		}
		let { schemes, hostRegex, authorityRegex, pathRegex } = splitRawRegexUrl(regex, rule);
		return {
			schemes,
			authorityRegex,
			pathRegex,
			hostRegex,
			isRegex: !0
		};
	}
	let { scheme, authority, path } = splitUrl(url, rule);
	rejectUserinfo(authority, rule), rejectQuery(path, rule);
	let colonIndex = authority.lastIndexOf(":"), hasPort = colonIndex !== -1 && !authority.slice(colonIndex + 1).includes("]"), host = hasPort ? authority.slice(0, colonIndex) : authority, port = hasPort ? authority.slice(colonIndex + 1) : "";
	if (host === "") throw Error(`Invalid URL in rule "${rule}": missing host`);
	port !== "" && checkPort(port, rule);
	let combined = wildcardToRegexPartial(`${host}:${port === "" ? DEFAULT_PORT[scheme] : port}`), hostRegex = combined.slice(0, combined.lastIndexOf(":")), pathRegex = path === "" ? "^/" : `^${pathToRegexPartial(path)}$`, authorityRegex = `^${hostRegex}:${port === "*" ? "[0-9]+" : port === "" ? DEFAULT_PORT[scheme] : port}$`;
	return {
		schemes: [scheme],
		authorityRegex,
		pathRegex,
		hostRegex,
		isRegex: !1
	};
}
function convertUrlRule(rule) {
	let trimmed = rule.trim(), separator = /\s+/.exec(trimmed);
	if (!separator) throw Error(`Invalid rule "${trimmed}": expected a method and a URL, e.g. "GET https://example.com/x"`);
	let methodSpec = trimmed.slice(0, separator.index), url = trimmed.slice(separator.index + separator[0].length).trim();
	if (/\s/.test(url)) throw Error(`Invalid rule "${trimmed}": URL must not contain whitespace`);
	let methods = parseMethods(methodSpec, trimmed), { schemes, authorityRegex, pathRegex, hostRegex, isRegex } = compileUrl(url, trimmed);
	return {
		methods,
		schemes,
		authorityRegex,
		pathRegex,
		hostRegex,
		isRegex,
		raw: trimmed
	};
}
function splitUrlRuleLines(rulesInput) {
	let lines = rulesInput?.split(/\r?\n/).map((line) => stripLineComment(line).trim()).filter((line) => line !== "") ?? [];
	return lines.forEach(rejectGluedHash), lines;
}
function buildUrlRules(rulesInput) {
	return splitUrlRuleLines(rulesInput).map(convertUrlRule);
}
//#endregion
//#region src/core/lib/acl/wildcard-rules.ts
function splitRuleTokens(rulesInput) {
	let tokens = rulesInput?.split(/\r?\n/).map(stripLineComment).join(" ").trim().split(/\s+/).filter(Boolean) ?? [];
	return tokens.forEach(rejectGluedHash), tokens;
}
function parseAndValidateRules(rulesInput) {
	let rules = splitRuleTokens(rulesInput);
	return rules.forEach(convertRule), rules;
}
function completeRulePort(rule) {
	if (!rule.startsWith("~")) return rule.includes(":") ? rule : `${rule}:*`;
	let regex = rule.slice(1);
	return splitDomainFromPortPattern(regex).portPattern === null ? `~${endsAnchored(regex) ? regex.slice(0, -1) : regex}:\\d+` : rule;
}
function splitKnownBlockedLines(rulesInput) {
	let lines = rulesInput?.split(/\r?\n/).map((line) => stripLineComment(line).trim()).filter((line) => line !== "") ?? [];
	return lines.forEach(rejectGluedHash), lines;
}
function isKnownBlockedUrlRule(line) {
	return /\s/.test(line.trim());
}
function parseAndValidateKnownBlockedRules(rulesInput) {
	return splitKnownBlockedLines(rulesInput).map((line) => {
		if (isKnownBlockedUrlRule(line)) return convertUrlRule(line), line;
		let completed = completeRulePort(line);
		return convertRule(completed), completed;
	});
}
function convertRule(rule) {
	return rule.startsWith("~") ? (splitRawRegexHost(rule), anchorRawRegex(rule.slice(1))) : `^${wildcardToRegex(rule)}$`;
}
function cidrToRegex(cidr) {
	let [address, prefix] = cidr.split("/");
	return address.split(".").map((octet, i) => {
		let bits = Math.min(Math.max(Number(prefix) - 8 * i, 0), 8);
		if (bits === 0) return "[0-9]+";
		let low = Number(octet) & 255 << 8 - bits & 255;
		return bits === 8 ? String(low) : `(?:${Array.from({ length: 2 ** (8 - bits) }, (_, n) => low + n).join("|")})`;
	}).join("\\.");
}
function domainToRegex(domain) {
	if (/^[\d.]+\/\d+$/.test(domain)) {
		if (!IPV4_CIDR.test(domain)) throw Error(`Invalid CIDR block "${domain}": each octet is a decimal from 0 to 255 without a leading zero, and the prefix is 0 to 32`);
		return cidrToRegex(domain);
	}
	return domain.split(".").map((part) => {
		if (checkHostLabel(part, domain), part === "**") return ".+";
		if (part === "*") return "[^.]+";
		if (part.includes("*")) throw Error(`Invalid wildcard in "${domain}": part "${part}" mixes "*" with other characters`);
		return part.replace(/[.+^$()[\]{}|\\]/g, "\\$&").replace(/\?/g, "[^.]");
	}).join("\\.");
}
function wildcardToRegex(pattern) {
	if (!/^[^:]+:[^:]*$/.test(pattern)) throw Error(`Invalid pattern "${pattern}"`);
	let [domain, port] = pattern.split(":");
	checkPort(port, pattern);
	let portRegex = port === "*" ? "\\d+" : port;
	return `${domainToRegex(domain)}:${portRegex}`;
}
//#endregion
//#region node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/nodes/identity.js
var require_identity = __commonJSMin(((exports) => {
	let ALIAS = Symbol.for("yaml.alias"), DOC = Symbol.for("yaml.document"), MAP = Symbol.for("yaml.map"), PAIR = Symbol.for("yaml.pair"), SCALAR = Symbol.for("yaml.scalar"), SEQ = Symbol.for("yaml.seq"), NODE_TYPE = Symbol.for("yaml.node.type"), isAlias = (node) => !!node && typeof node == "object" && node[NODE_TYPE] === ALIAS, isDocument = (node) => !!node && typeof node == "object" && node[NODE_TYPE] === DOC, isMap = (node) => !!node && typeof node == "object" && node[NODE_TYPE] === MAP, isPair = (node) => !!node && typeof node == "object" && node[NODE_TYPE] === PAIR, isScalar = (node) => !!node && typeof node == "object" && node[NODE_TYPE] === SCALAR, isSeq = (node) => !!node && typeof node == "object" && node[NODE_TYPE] === SEQ;
	function isCollection(node) {
		if (node && typeof node == "object") switch (node[NODE_TYPE]) {
			case MAP:
			case SEQ: return !0;
		}
		return !1;
	}
	function isNode(node) {
		if (node && typeof node == "object") switch (node[NODE_TYPE]) {
			case ALIAS:
			case MAP:
			case SCALAR:
			case SEQ: return !0;
		}
		return !1;
	}
	exports.ALIAS = ALIAS, exports.DOC = DOC, exports.MAP = MAP, exports.NODE_TYPE = NODE_TYPE, exports.PAIR = PAIR, exports.SCALAR = SCALAR, exports.SEQ = SEQ, exports.hasAnchor = (node) => (isScalar(node) || isCollection(node)) && !!node.anchor, exports.isAlias = isAlias, exports.isCollection = isCollection, exports.isDocument = isDocument, exports.isMap = isMap, exports.isNode = isNode, exports.isPair = isPair, exports.isScalar = isScalar, exports.isSeq = isSeq;
})), require_visit = __commonJSMin(((exports) => {
	var identity = require_identity();
	let BREAK = Symbol("break visit"), SKIP = Symbol("skip children"), REMOVE = Symbol("remove node");
	function visit(node, visitor) {
		let visitor_ = initVisitor(visitor);
		identity.isDocument(node) ? visit_(null, node.contents, visitor_, Object.freeze([node])) === REMOVE && (node.contents = null) : visit_(null, node, visitor_, Object.freeze([]));
	}
	visit.BREAK = BREAK, visit.SKIP = SKIP, visit.REMOVE = REMOVE;
	function visit_(key, node, visitor, path) {
		let ctrl = callVisitor(key, node, visitor, path);
		if (identity.isNode(ctrl) || identity.isPair(ctrl)) return replaceNode(key, path, ctrl), visit_(key, ctrl, visitor, path);
		if (typeof ctrl != "symbol") {
			if (identity.isCollection(node)) {
				path = Object.freeze(path.concat(node));
				for (let i = 0; i < node.items.length; ++i) {
					let ci = visit_(i, node.items[i], visitor, path);
					if (typeof ci == "number") i = ci - 1;
					else if (ci === BREAK) return BREAK;
					else ci === REMOVE && (node.items.splice(i, 1), --i);
				}
			} else if (identity.isPair(node)) {
				path = Object.freeze(path.concat(node));
				let ck = visit_("key", node.key, visitor, path);
				if (ck === BREAK) return BREAK;
				ck === REMOVE && (node.key = null);
				let cv = visit_("value", node.value, visitor, path);
				if (cv === BREAK) return BREAK;
				cv === REMOVE && (node.value = null);
			}
		}
		return ctrl;
	}
	async function visitAsync(node, visitor) {
		let visitor_ = initVisitor(visitor);
		identity.isDocument(node) ? await visitAsync_(null, node.contents, visitor_, Object.freeze([node])) === REMOVE && (node.contents = null) : await visitAsync_(null, node, visitor_, Object.freeze([]));
	}
	visitAsync.BREAK = BREAK, visitAsync.SKIP = SKIP, visitAsync.REMOVE = REMOVE;
	async function visitAsync_(key, node, visitor, path) {
		let ctrl = await callVisitor(key, node, visitor, path);
		if (identity.isNode(ctrl) || identity.isPair(ctrl)) return replaceNode(key, path, ctrl), visitAsync_(key, ctrl, visitor, path);
		if (typeof ctrl != "symbol") {
			if (identity.isCollection(node)) {
				path = Object.freeze(path.concat(node));
				for (let i = 0; i < node.items.length; ++i) {
					let ci = await visitAsync_(i, node.items[i], visitor, path);
					if (typeof ci == "number") i = ci - 1;
					else if (ci === BREAK) return BREAK;
					else ci === REMOVE && (node.items.splice(i, 1), --i);
				}
			} else if (identity.isPair(node)) {
				path = Object.freeze(path.concat(node));
				let ck = await visitAsync_("key", node.key, visitor, path);
				if (ck === BREAK) return BREAK;
				ck === REMOVE && (node.key = null);
				let cv = await visitAsync_("value", node.value, visitor, path);
				if (cv === BREAK) return BREAK;
				cv === REMOVE && (node.value = null);
			}
		}
		return ctrl;
	}
	function initVisitor(visitor) {
		return typeof visitor == "object" && (visitor.Collection || visitor.Node || visitor.Value) ? Object.assign({
			Alias: visitor.Node,
			Map: visitor.Node,
			Scalar: visitor.Node,
			Seq: visitor.Node
		}, visitor.Value && {
			Map: visitor.Value,
			Scalar: visitor.Value,
			Seq: visitor.Value
		}, visitor.Collection && {
			Map: visitor.Collection,
			Seq: visitor.Collection
		}, visitor) : visitor;
	}
	function callVisitor(key, node, visitor, path) {
		if (typeof visitor == "function") return visitor(key, node, path);
		if (identity.isMap(node)) return visitor.Map?.(key, node, path);
		if (identity.isSeq(node)) return visitor.Seq?.(key, node, path);
		if (identity.isPair(node)) return visitor.Pair?.(key, node, path);
		if (identity.isScalar(node)) return visitor.Scalar?.(key, node, path);
		if (identity.isAlias(node)) return visitor.Alias?.(key, node, path);
	}
	function replaceNode(key, path, node) {
		let parent = path[path.length - 1];
		if (identity.isCollection(parent)) parent.items[key] = node;
		else if (identity.isPair(parent)) key === "key" ? parent.key = node : parent.value = node;
		else if (identity.isDocument(parent)) parent.contents = node;
		else {
			let pt = identity.isAlias(parent) ? "alias" : "scalar";
			throw Error(`Cannot replace node with ${pt} parent`);
		}
	}
	exports.visit = visit, exports.visitAsync = visitAsync;
})), require_directives = __commonJSMin(((exports) => {
	var identity = require_identity(), visit = require_visit();
	let escapeChars = {
		"!": "%21",
		",": "%2C",
		"[": "%5B",
		"]": "%5D",
		"{": "%7B",
		"}": "%7D"
	}, escapeTagName = (tn) => tn.replace(/[!,[\]{}]/g, (ch) => escapeChars[ch]);
	var Directives = class Directives {
		constructor(yaml, tags) {
			this.docStart = null, this.docEnd = !1, this.yaml = Object.assign({}, Directives.defaultYaml, yaml), this.tags = Object.assign({}, Directives.defaultTags, tags);
		}
		clone() {
			let copy = new Directives(this.yaml, this.tags);
			return copy.docStart = this.docStart, copy;
		}
		atDocument() {
			let res = new Directives(this.yaml, this.tags);
			switch (this.yaml.version) {
				case "1.1":
					this.atNextDocument = !0;
					break;
				case "1.2": this.atNextDocument = !1, this.yaml = {
					explicit: Directives.defaultYaml.explicit,
					version: "1.2"
				}, this.tags = Object.assign({}, Directives.defaultTags);
			}
			return res;
		}
		add(line, onError) {
			this.atNextDocument &&= (this.yaml = {
				explicit: Directives.defaultYaml.explicit,
				version: "1.1"
			}, this.tags = Object.assign({}, Directives.defaultTags), !1);
			let parts = line.trim().split(/[ \t]+/), name = parts.shift();
			switch (name) {
				case "%TAG": {
					if (parts.length !== 2 && (onError(0, "%TAG directive should contain exactly two parts"), parts.length < 2)) return !1;
					let [handle, prefix] = parts;
					return this.tags[handle] = prefix, !0;
				}
				case "%YAML": {
					if (this.yaml.explicit = !0, parts.length !== 1) return onError(0, "%YAML directive should contain exactly one part"), !1;
					let [version] = parts;
					if (version === "1.1" || version === "1.2") return this.yaml.version = version, !0;
					{
						let isValid = /^\d+\.\d+$/.test(version);
						return onError(6, `Unsupported YAML version ${version}`, isValid), !1;
					}
				}
				default: return onError(0, `Unknown directive ${name}`, !0), !1;
			}
		}
		tagName(source, onError) {
			if (source === "!") return "!";
			if (source[0] !== "!") return onError(`Not a valid tag: ${source}`), null;
			if (source[1] === "<") {
				let verbatim = source.slice(2, -1);
				return verbatim === "!" || verbatim === "!!" ? (onError(`Verbatim tags aren't resolved, so ${source} is invalid.`), null) : (source[source.length - 1] !== ">" && onError("Verbatim tags must end with a >"), verbatim);
			}
			let [, handle, suffix] = source.match(/^(.*!)([^!]*)$/s);
			suffix || onError(`The ${source} tag has no suffix`);
			let prefix = this.tags[handle];
			if (prefix) try {
				return prefix + decodeURIComponent(suffix);
			} catch (error) {
				return onError(String(error)), null;
			}
			return handle === "!" ? source : (onError(`Could not resolve tag: ${source}`), null);
		}
		tagString(tag) {
			for (let [handle, prefix] of Object.entries(this.tags)) if (tag.startsWith(prefix)) return handle + escapeTagName(tag.substring(prefix.length));
			return tag[0] === "!" ? tag : `!<${tag}>`;
		}
		toString(doc) {
			let lines = this.yaml.explicit ? [`%YAML ${this.yaml.version || "1.2"}`] : [], tagEntries = Object.entries(this.tags), tagNames;
			if (doc && tagEntries.length > 0 && identity.isNode(doc.contents)) {
				let tags = {};
				visit.visit(doc.contents, (_key, node) => {
					identity.isNode(node) && node.tag && (tags[node.tag] = !0);
				}), tagNames = Object.keys(tags);
			} else tagNames = [];
			for (let [handle, prefix] of tagEntries) (handle !== "!!" || prefix !== "tag:yaml.org,2002:") && (!doc || tagNames.some((tn) => tn.startsWith(prefix))) && lines.push(`%TAG ${handle} ${prefix}`);
			return lines.join("\n");
		}
	};
	Directives.defaultYaml = {
		explicit: !1,
		version: "1.2"
	}, Directives.defaultTags = { "!!": "tag:yaml.org,2002:" }, exports.Directives = Directives;
})), require_anchors = __commonJSMin(((exports) => {
	var identity = require_identity(), visit = require_visit();
	function anchorIsValid(anchor) {
		if (/[\x00-\x19\s,[\]{}]/.test(anchor)) {
			let msg = `Anchor must not contain whitespace or control characters: ${JSON.stringify(anchor)}`;
			throw Error(msg);
		}
		return !0;
	}
	function anchorNames(root) {
		let anchors = new Set();
		return visit.visit(root, { Value(_key, node) {
			node.anchor && anchors.add(node.anchor);
		} }), anchors;
	}
	function findNewAnchor(prefix, exclude) {
		for (let i = 1;; ++i) {
			let name = `${prefix}${i}`;
			if (!exclude.has(name)) return name;
		}
	}
	function createNodeAnchors(doc, prefix) {
		let aliasObjects = [], sourceObjects = new Map(), prevAnchors = null;
		return {
			onAnchor: (source) => {
				aliasObjects.push(source), prevAnchors ??= anchorNames(doc);
				let anchor = findNewAnchor(prefix, prevAnchors);
				return prevAnchors.add(anchor), anchor;
			},
			setAnchors: () => {
				for (let source of aliasObjects) {
					let ref = sourceObjects.get(source);
					if (typeof ref == "object" && ref.anchor && (identity.isScalar(ref.node) || identity.isCollection(ref.node))) ref.node.anchor = ref.anchor;
					else {
						let error = Error("Failed to resolve repeated object (this should not happen)");
						throw error.source = source, error;
					}
				}
			},
			sourceObjects
		};
	}
	exports.anchorIsValid = anchorIsValid, exports.anchorNames = anchorNames, exports.createNodeAnchors = createNodeAnchors, exports.findNewAnchor = findNewAnchor;
})), require_applyReviver = __commonJSMin(((exports) => {
	function applyReviver(reviver, obj, key, val) {
		if (val && typeof val == "object") {
			if (Array.isArray(val)) for (let i = 0, len = val.length; i < len; ++i) {
				let v0 = val[i], v1 = applyReviver(reviver, val, String(i), v0);
				v1 === void 0 ? delete val[i] : v1 !== v0 && (val[i] = v1);
			}
			else if (val instanceof Map) for (let k of Array.from(val.keys())) {
				let v0 = val.get(k), v1 = applyReviver(reviver, val, k, v0);
				v1 === void 0 ? val.delete(k) : v1 !== v0 && val.set(k, v1);
			}
			else if (val instanceof Set) for (let v0 of Array.from(val)) {
				let v1 = applyReviver(reviver, val, v0, v0);
				v1 === void 0 ? val.delete(v0) : v1 !== v0 && (val.delete(v0), val.add(v1));
			}
			else for (let [k, v0] of Object.entries(val)) {
				let v1 = applyReviver(reviver, val, k, v0);
				v1 === void 0 ? delete val[k] : v1 !== v0 && (val[k] = v1);
			}
		}
		return reviver.call(obj, key, val);
	}
	exports.applyReviver = applyReviver;
})), require_toJS = __commonJSMin(((exports) => {
	var identity = require_identity();
	function toJS(value, arg, ctx) {
		if (Array.isArray(value)) return value.map((v, i) => toJS(v, String(i), ctx));
		if (value && typeof value.toJSON == "function") {
			if (!ctx || !identity.hasAnchor(value)) return value.toJSON(arg, ctx);
			let data = {
				aliasCount: 0,
				count: 1,
				res: void 0
			};
			ctx.anchors.set(value, data), ctx.onCreate = (res) => {
				data.res = res, delete ctx.onCreate;
			};
			let res = value.toJSON(arg, ctx);
			return ctx.onCreate && ctx.onCreate(res), res;
		}
		return typeof value == "bigint" && !ctx?.keep ? Number(value) : value;
	}
	exports.toJS = toJS;
})), require_Node = __commonJSMin(((exports) => {
	var applyReviver = require_applyReviver(), identity = require_identity(), toJS = require_toJS();
	exports.NodeBase = class {
		constructor(type) {
			Object.defineProperty(this, identity.NODE_TYPE, { value: type });
		}
		clone() {
			let copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
			return this.range && (copy.range = this.range.slice()), copy;
		}
		toJS(doc, { mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
			if (!identity.isDocument(doc)) throw TypeError("A document argument is required");
			let ctx = {
				anchors: new Map(),
				doc,
				keep: !0,
				mapAsMap: mapAsMap === !0,
				mapKeyWarned: !1,
				maxAliasCount: typeof maxAliasCount == "number" ? maxAliasCount : 100
			}, res = toJS.toJS(this, "", ctx);
			if (typeof onAnchor == "function") for (let { count, res } of ctx.anchors.values()) onAnchor(res, count);
			return typeof reviver == "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
		}
	};
})), require_Alias = __commonJSMin(((exports) => {
	var anchors = require_anchors(), visit = require_visit(), identity = require_identity(), Node = require_Node(), toJS = require_toJS(), Alias = class extends Node.NodeBase {
		constructor(source) {
			super(identity.ALIAS), this.source = source, Object.defineProperty(this, "tag", { set() {
				throw Error("Alias nodes cannot have tags");
			} });
		}
		resolve(doc, ctx) {
			if (ctx?.maxAliasCount === 0) throw ReferenceError("Alias resolution is disabled");
			let nodes;
			ctx?.aliasResolveCache ? nodes = ctx.aliasResolveCache : (nodes = [], visit.visit(doc, { Node: (_key, node) => {
				(identity.isAlias(node) || identity.hasAnchor(node)) && nodes.push(node);
			} }), ctx && (ctx.aliasResolveCache = nodes));
			let found;
			for (let node of nodes) {
				if (node === this) break;
				node.anchor === this.source && (found = node);
			}
			if (found && ctx) {
				let { anchors, doc, maxAliasCount } = ctx, data = anchors.get(found);
				if (data ||= (toJS.toJS(found, null, ctx), anchors.get(found)), data?.res === void 0) throw ReferenceError("This should not happen: Alias anchor was not resolved?");
				if (maxAliasCount >= 0 && (data.count += 1, data.aliasCount === 0 && (data.aliasCount = getAliasCount(doc, found, anchors)), data.count * data.aliasCount > maxAliasCount)) throw ReferenceError("Excessive alias count indicates a resource exhaustion attack");
			}
			return found;
		}
		toJSON(_arg, ctx) {
			if (!ctx) return { source: this.source };
			let source = this.resolve(ctx.doc, ctx);
			if (!source) {
				let msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
				throw ReferenceError(msg);
			}
			return ctx.anchors.get(source).res;
		}
		toString(ctx, _onComment, _onChompKeep) {
			let src = `*${this.source}`;
			if (ctx) {
				if (anchors.anchorIsValid(this.source), ctx.options.verifyAliasOrder && !ctx.anchors.has(this.source)) {
					let msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
					throw Error(msg);
				}
				if (ctx.implicitKey) return `${src} `;
			}
			return src;
		}
	};
	function getAliasCount(doc, node, anchors) {
		if (identity.isAlias(node)) {
			let source = node.resolve(doc), anchor = anchors && source && anchors.get(source);
			return anchor ? anchor.count * anchor.aliasCount : 0;
		}
		if (identity.isCollection(node)) {
			let count = 0;
			for (let item of node.items) {
				let c = getAliasCount(doc, item, anchors);
				c > count && (count = c);
			}
			return count;
		}
		if (identity.isPair(node)) {
			let kc = getAliasCount(doc, node.key, anchors), vc = getAliasCount(doc, node.value, anchors);
			return Math.max(kc, vc);
		}
		return 1;
	}
	exports.Alias = Alias;
})), require_Scalar = __commonJSMin(((exports) => {
	var identity = require_identity(), Node = require_Node(), toJS = require_toJS();
	let isScalarValue = (value) => !value || typeof value != "function" && typeof value != "object";
	var Scalar = class extends Node.NodeBase {
		constructor(value) {
			super(identity.SCALAR), this.value = value;
		}
		toJSON(arg, ctx) {
			return ctx?.keep ? this.value : toJS.toJS(this.value, arg, ctx);
		}
		toString() {
			return String(this.value);
		}
	};
	Scalar.BLOCK_FOLDED = "BLOCK_FOLDED", Scalar.BLOCK_LITERAL = "BLOCK_LITERAL", Scalar.PLAIN = "PLAIN", Scalar.QUOTE_DOUBLE = "QUOTE_DOUBLE", Scalar.QUOTE_SINGLE = "QUOTE_SINGLE", exports.Scalar = Scalar, exports.isScalarValue = isScalarValue;
})), require_createNode = __commonJSMin(((exports) => {
	var Alias = require_Alias(), identity = require_identity(), Scalar = require_Scalar();
	function findTagObject(value, tagName, tags) {
		if (tagName) {
			let match = tags.filter((t) => t.tag === tagName), tagObj = match.find((t) => !t.format) ?? match[0];
			if (!tagObj) throw Error(`Tag ${tagName} not found`);
			return tagObj;
		}
		return tags.find((t) => t.identify?.(value) && !t.format);
	}
	function createNode(value, tagName, ctx) {
		if (identity.isDocument(value) && (value = value.contents), identity.isNode(value)) return value;
		if (identity.isPair(value)) {
			let map = ctx.schema[identity.MAP].createNode?.(ctx.schema, null, ctx);
			return map.items.push(value), map;
		}
		(value instanceof String || value instanceof Number || value instanceof Boolean || typeof BigInt < "u" && value instanceof BigInt) && (value = value.valueOf());
		let { aliasDuplicateObjects, onAnchor, onTagObj, schema, sourceObjects } = ctx, ref;
		if (aliasDuplicateObjects && value && typeof value == "object") {
			if (ref = sourceObjects.get(value), ref) return ref.anchor ?? (ref.anchor = onAnchor(value)), new Alias.Alias(ref.anchor);
			ref = {
				anchor: null,
				node: null
			}, sourceObjects.set(value, ref);
		}
		tagName?.startsWith("!!") && (tagName = "tag:yaml.org,2002:" + tagName.slice(2));
		let tagObj = findTagObject(value, tagName, schema.tags);
		if (!tagObj) {
			if (value && typeof value.toJSON == "function" && (value = value.toJSON()), !value || typeof value != "object") {
				let node = new Scalar.Scalar(value);
				return ref && (ref.node = node), node;
			}
			tagObj = value instanceof Map ? schema[identity.MAP] : Symbol.iterator in Object(value) ? schema[identity.SEQ] : schema[identity.MAP];
		}
		onTagObj && (onTagObj(tagObj), delete ctx.onTagObj);
		let node = tagObj?.createNode ? tagObj.createNode(ctx.schema, value, ctx) : typeof tagObj?.nodeClass?.from == "function" ? tagObj.nodeClass.from(ctx.schema, value, ctx) : new Scalar.Scalar(value);
		return tagName ? node.tag = tagName : tagObj.default || (node.tag = tagObj.tag), ref && (ref.node = node), node;
	}
	exports.createNode = createNode;
})), require_Collection = __commonJSMin(((exports) => {
	var createNode = require_createNode(), identity = require_identity(), Node = require_Node();
	function collectionFromPath(schema, path, value) {
		let v = value;
		for (let i = path.length - 1; i >= 0; --i) {
			let k = path[i];
			if (typeof k == "number" && Number.isInteger(k) && k >= 0) {
				let a = [];
				a[k] = v, v = a;
			} else v = new Map([[k, v]]);
		}
		return createNode.createNode(v, void 0, {
			aliasDuplicateObjects: !1,
			keepUndefined: !1,
			onAnchor: () => {
				throw Error("This should not happen, please report a bug.");
			},
			schema,
			sourceObjects: new Map()
		});
	}
	let isEmptyPath = (path) => path == null || typeof path == "object" && !!path[Symbol.iterator]().next().done;
	exports.Collection = class extends Node.NodeBase {
		constructor(type, schema) {
			super(type), Object.defineProperty(this, "schema", {
				value: schema,
				configurable: !0,
				enumerable: !1,
				writable: !0
			});
		}
		clone(schema) {
			let copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
			return schema && (copy.schema = schema), copy.items = copy.items.map((it) => identity.isNode(it) || identity.isPair(it) ? it.clone(schema) : it), this.range && (copy.range = this.range.slice()), copy;
		}
		addIn(path, value) {
			if (isEmptyPath(path)) this.add(value);
			else {
				let [key, ...rest] = path, node = this.get(key, !0);
				if (identity.isCollection(node)) node.addIn(rest, value);
				else if (node === void 0 && this.schema) this.set(key, collectionFromPath(this.schema, rest, value));
				else throw Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
			}
		}
		deleteIn(path) {
			let [key, ...rest] = path;
			if (rest.length === 0) return this.delete(key);
			let node = this.get(key, !0);
			if (identity.isCollection(node)) return node.deleteIn(rest);
			throw Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
		}
		getIn(path, keepScalar) {
			let [key, ...rest] = path, node = this.get(key, !0);
			return rest.length === 0 ? !keepScalar && identity.isScalar(node) ? node.value : node : identity.isCollection(node) ? node.getIn(rest, keepScalar) : void 0;
		}
		hasAllNullValues(allowScalar) {
			return this.items.every((node) => {
				if (!identity.isPair(node)) return !1;
				let n = node.value;
				return n == null || allowScalar && identity.isScalar(n) && n.value == null && !n.commentBefore && !n.comment && !n.tag;
			});
		}
		hasIn(path) {
			let [key, ...rest] = path;
			if (rest.length === 0) return this.has(key);
			let node = this.get(key, !0);
			return identity.isCollection(node) ? node.hasIn(rest) : !1;
		}
		setIn(path, value) {
			let [key, ...rest] = path;
			if (rest.length === 0) this.set(key, value);
			else {
				let node = this.get(key, !0);
				if (identity.isCollection(node)) node.setIn(rest, value);
				else if (node === void 0 && this.schema) this.set(key, collectionFromPath(this.schema, rest, value));
				else throw Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
			}
		}
	}, exports.collectionFromPath = collectionFromPath, exports.isEmptyPath = isEmptyPath;
})), require_stringifyComment = __commonJSMin(((exports) => {
	let stringifyComment = (str) => str.replace(/^(?!$)(?: $)?/gm, "#");
	function indentComment(comment, indent) {
		return /^\n+$/.test(comment) ? comment.substring(1) : indent ? comment.replace(/^(?! *$)/gm, indent) : comment;
	}
	exports.indentComment = indentComment, exports.lineComment = (str, indent, comment) => str.endsWith("\n") ? indentComment(comment, indent) : comment.includes("\n") ? "\n" + indentComment(comment, indent) : (str.endsWith(" ") ? "" : " ") + comment, exports.stringifyComment = stringifyComment;
})), require_foldFlowLines = __commonJSMin(((exports) => {
	let FOLD_BLOCK = "block", FOLD_QUOTED = "quoted";
	function foldFlowLines(text, indent, mode = "flow", { indentAtStart, lineWidth = 80, minContentWidth = 20, onFold, onOverflow } = {}) {
		if (!lineWidth || lineWidth < 0) return text;
		lineWidth < minContentWidth && (minContentWidth = 0);
		let endStep = Math.max(1 + minContentWidth, 1 + lineWidth - indent.length);
		if (text.length <= endStep) return text;
		let folds = [], escapedFolds = {}, end = lineWidth - indent.length;
		typeof indentAtStart == "number" && (indentAtStart > lineWidth - Math.max(2, minContentWidth) ? folds.push(0) : end = lineWidth - indentAtStart);
		let split, prev, overflow = !1, i = -1, escStart = -1, escEnd = -1;
		mode === FOLD_BLOCK && (i = consumeMoreIndentedLines(text, i, indent.length), i !== -1 && (end = i + endStep));
		for (let ch; ch = text[i += 1];) {
			if (mode === FOLD_QUOTED && ch === "\\") {
				switch (escStart = i, text[i + 1]) {
					case "x":
						i += 3;
						break;
					case "u":
						i += 5;
						break;
					case "U":
						i += 9;
						break;
					default: i += 1;
				}
				escEnd = i;
			}
			if (ch === "\n") mode === FOLD_BLOCK && (i = consumeMoreIndentedLines(text, i, indent.length)), end = i + indent.length + endStep, split = void 0;
			else {
				if (ch === " " && prev && prev !== " " && prev !== "\n" && prev !== "	") {
					let next = text[i + 1];
					next && next !== " " && next !== "\n" && next !== "	" && (split = i);
				}
				if (i >= end) {
					if (split) folds.push(split), end = split + endStep, split = void 0;
					else if (mode === FOLD_QUOTED) {
						for (; prev === " " || prev === "	";) prev = ch, ch = text[i += 1], overflow = !0;
						let j = i > escEnd + 1 ? i - 2 : escStart - 1;
						if (escapedFolds[j]) return text;
						folds.push(j), escapedFolds[j] = !0, end = j + endStep, split = void 0;
					} else overflow = !0;
				}
			}
			prev = ch;
		}
		if (overflow && onOverflow && onOverflow(), folds.length === 0) return text;
		onFold && onFold();
		let res = text.slice(0, folds[0]);
		for (let i = 0; i < folds.length; ++i) {
			let fold = folds[i], end = folds[i + 1] || text.length;
			fold === 0 ? res = `\n${indent}${text.slice(0, end)}` : (mode === FOLD_QUOTED && escapedFolds[fold] && (res += `${text[fold]}\\`), res += `\n${indent}${text.slice(fold + 1, end)}`);
		}
		return res;
	}
	function consumeMoreIndentedLines(text, i, indent) {
		let end = i, start = i + 1, ch = text[start];
		for (; ch === " " || ch === "	";) if (i < start + indent) ch = text[++i];
		else {
			do
				ch = text[++i];
			while (ch && ch !== "\n");
			end = i, start = i + 1, ch = text[start];
		}
		return end;
	}
	exports.FOLD_BLOCK = FOLD_BLOCK, exports.FOLD_FLOW = "flow", exports.FOLD_QUOTED = FOLD_QUOTED, exports.foldFlowLines = foldFlowLines;
})), require_stringifyString = __commonJSMin(((exports) => {
	var Scalar = require_Scalar(), foldFlowLines = require_foldFlowLines();
	let getFoldOptions = (ctx, isBlock) => ({
		indentAtStart: isBlock ? ctx.indent.length : ctx.indentAtStart,
		lineWidth: ctx.options.lineWidth,
		minContentWidth: ctx.options.minContentWidth
	}), containsDocumentMarker = (str) => /^(%|---|\.\.\.)/m.test(str);
	function lineLengthOverLimit(str, lineWidth, indentLength) {
		if (!lineWidth || lineWidth < 0) return !1;
		let limit = lineWidth - indentLength, strLen = str.length;
		if (strLen <= limit) return !1;
		for (let i = 0, start = 0; i < strLen; ++i) if (str[i] === "\n") {
			if (i - start > limit) return !0;
			if (start = i + 1, strLen - start <= limit) return !1;
		}
		return !0;
	}
	function doubleQuotedString(value, ctx) {
		let json = JSON.stringify(value);
		if (ctx.options.doubleQuotedAsJSON) return json;
		let { implicitKey } = ctx, minMultiLineLength = ctx.options.doubleQuotedMinMultiLineLength, indent = ctx.indent || (containsDocumentMarker(value) ? "  " : ""), str = "", start = 0;
		for (let i = 0, ch = json[i]; ch; ch = json[++i]) if (ch === " " && json[i + 1] === "\\" && json[i + 2] === "n" && (str += json.slice(start, i) + "\\ ", i += 1, start = i, ch = "\\"), ch === "\\") switch (json[i + 1]) {
			case "u":
				{
					str += json.slice(start, i);
					let code = json.substr(i + 2, 4);
					switch (code) {
						case "0000":
							str += "\\0";
							break;
						case "0007":
							str += "\\a";
							break;
						case "000b":
							str += "\\v";
							break;
						case "001b":
							str += "\\e";
							break;
						case "0085":
							str += "\\N";
							break;
						case "00a0":
							str += "\\_";
							break;
						case "2028":
							str += "\\L";
							break;
						case "2029":
							str += "\\P";
							break;
						default: code.substr(0, 2) === "00" ? str += "\\x" + code.substr(2) : str += json.substr(i, 6);
					}
					i += 5, start = i + 1;
				}
				break;
			case "n":
				if (implicitKey || json[i + 2] === "\"" || json.length < minMultiLineLength) i += 1;
				else {
					for (str += json.slice(start, i) + "\n\n"; json[i + 2] === "\\" && json[i + 3] === "n" && json[i + 4] !== "\"";) str += "\n", i += 2;
					str += indent, json[i + 2] === " " && (str += "\\"), i += 1, start = i + 1;
				}
				break;
			default: i += 1;
		}
		return str = start ? str + json.slice(start) : json, implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_QUOTED, getFoldOptions(ctx, !1));
	}
	function singleQuotedString(value, ctx) {
		if (ctx.options.singleQuote === !1 || ctx.implicitKey && value.includes("\n") || /[ \t]\n|\n[ \t]/.test(value)) return doubleQuotedString(value, ctx);
		let indent = ctx.indent || (containsDocumentMarker(value) ? "  " : ""), res = "'" + value.replace(/'/g, "''").replace(/\n+/g, `$&\n${indent}`) + "'";
		return ctx.implicitKey ? res : foldFlowLines.foldFlowLines(res, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, !1));
	}
	function quotedString(value, ctx) {
		let { singleQuote } = ctx.options, qs;
		if (singleQuote === !1) qs = doubleQuotedString;
		else {
			let hasDouble = value.includes("\""), hasSingle = value.includes("'");
			qs = hasDouble && !hasSingle ? singleQuotedString : hasSingle && !hasDouble ? doubleQuotedString : singleQuote ? singleQuotedString : doubleQuotedString;
		}
		return qs(value, ctx);
	}
	let blockEndNewlines;
	try {
		blockEndNewlines = RegExp("(^|(?<!\n))\n+(?!\n|$)", "g");
	} catch {
		blockEndNewlines = /\n+(?!\n|$)/g;
	}
	function blockString({ comment, type, value }, ctx, onComment, onChompKeep) {
		let { blockQuote, commentString, lineWidth } = ctx.options;
		if (!blockQuote || /\n[\t ]+$/.test(value)) return quotedString(value, ctx);
		let indent = ctx.indent || (ctx.forceBlockIndent || containsDocumentMarker(value) ? "  " : ""), literal = blockQuote === "literal" ? !0 : blockQuote === "folded" || type === Scalar.Scalar.BLOCK_FOLDED ? !1 : type === Scalar.Scalar.BLOCK_LITERAL || !lineLengthOverLimit(value, lineWidth, indent.length);
		if (!value) return literal ? "|\n" : ">\n";
		let chomp, endStart;
		for (endStart = value.length; endStart > 0; --endStart) {
			let ch = value[endStart - 1];
			if (ch !== "\n" && ch !== "	" && ch !== " ") break;
		}
		let end = value.substring(endStart), endNlPos = end.indexOf("\n");
		endNlPos === -1 ? chomp = "-" : value === end || endNlPos !== end.length - 1 ? (chomp = "+", onChompKeep && onChompKeep()) : chomp = "", end &&= (value = value.slice(0, -end.length), end[end.length - 1] === "\n" && (end = end.slice(0, -1)), end.replace(blockEndNewlines, `$&${indent}`));
		let startWithSpace = !1, startEnd, startNlPos = -1;
		for (startEnd = 0; startEnd < value.length; ++startEnd) {
			let ch = value[startEnd];
			if (ch === " ") startWithSpace = !0;
			else if (ch === "\n") startNlPos = startEnd;
			else break;
		}
		let start = value.substring(0, startNlPos < startEnd ? startNlPos + 1 : startEnd);
		start &&= (value = value.substring(start.length), start.replace(/\n+/g, `$&${indent}`));
		let header = (startWithSpace ? indent ? "2" : "1" : "") + chomp;
		if (comment && (header += " " + commentString(comment.replace(/ ?[\r\n]+/g, " ")), onComment && onComment()), !literal) {
			let foldedValue = value.replace(/\n+/g, "\n$&").replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, "$1$2").replace(/\n+/g, `$&${indent}`), literalFallback = !1, foldOptions = getFoldOptions(ctx, !0);
			blockQuote !== "folded" && type !== Scalar.Scalar.BLOCK_FOLDED && (foldOptions.onOverflow = () => {
				literalFallback = !0;
			});
			let body = foldFlowLines.foldFlowLines(`${start}${foldedValue}${end}`, indent, foldFlowLines.FOLD_BLOCK, foldOptions);
			if (!literalFallback) return `>${header}\n${indent}${body}`;
		}
		return value = value.replace(/\n+/g, `$&${indent}`), `|${header}\n${indent}${start}${value}${end}`;
	}
	function plainString(item, ctx, onComment, onChompKeep) {
		let { type, value } = item, { actualString, implicitKey, indent, indentStep, inFlow } = ctx;
		if (implicitKey && value.includes("\n") || inFlow && /[[\]{},]/.test(value)) return quotedString(value, ctx);
		if (/^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(value)) return implicitKey || inFlow || !value.includes("\n") ? quotedString(value, ctx) : blockString(item, ctx, onComment, onChompKeep);
		if (!implicitKey && !inFlow && type !== Scalar.Scalar.PLAIN && value.includes("\n")) return blockString(item, ctx, onComment, onChompKeep);
		if (containsDocumentMarker(value)) {
			if (indent === "") return ctx.forceBlockIndent = !0, blockString(item, ctx, onComment, onChompKeep);
			if (implicitKey && indent === indentStep) return quotedString(value, ctx);
		}
		let str = value.replace(/\n+/g, `$&\n${indent}`);
		if (actualString) {
			let test = (tag) => tag.default && tag.tag !== "tag:yaml.org,2002:str" && tag.test?.test(str), { compat, tags } = ctx.doc.schema;
			if (tags.some(test) || compat?.some(test)) return quotedString(value, ctx);
		}
		return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, !1));
	}
	function stringifyString(item, ctx, onComment, onChompKeep) {
		let { implicitKey, inFlow } = ctx, ss = typeof item.value == "string" ? item : Object.assign({}, item, { value: String(item.value) }), { type } = item;
		type !== Scalar.Scalar.QUOTE_DOUBLE && /[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(ss.value) && (type = Scalar.Scalar.QUOTE_DOUBLE);
		let _stringify = (_type) => {
			switch (_type) {
				case Scalar.Scalar.BLOCK_FOLDED:
				case Scalar.Scalar.BLOCK_LITERAL: return implicitKey || inFlow ? quotedString(ss.value, ctx) : blockString(ss, ctx, onComment, onChompKeep);
				case Scalar.Scalar.QUOTE_DOUBLE: return doubleQuotedString(ss.value, ctx);
				case Scalar.Scalar.QUOTE_SINGLE: return singleQuotedString(ss.value, ctx);
				case Scalar.Scalar.PLAIN: return plainString(ss, ctx, onComment, onChompKeep);
				default: return null;
			}
		}, res = _stringify(type);
		if (res === null) {
			let { defaultKeyType, defaultStringType } = ctx.options, t = implicitKey && defaultKeyType || defaultStringType;
			if (res = _stringify(t), res === null) throw Error(`Unsupported default string type ${t}`);
		}
		return res;
	}
	exports.stringifyString = stringifyString;
})), require_stringify = __commonJSMin(((exports) => {
	var anchors = require_anchors(), identity = require_identity(), stringifyComment = require_stringifyComment(), stringifyString = require_stringifyString();
	function createStringifyContext(doc, options) {
		let opt = Object.assign({
			blockQuote: !0,
			commentString: stringifyComment.stringifyComment,
			defaultKeyType: null,
			defaultStringType: "PLAIN",
			directives: null,
			doubleQuotedAsJSON: !1,
			doubleQuotedMinMultiLineLength: 40,
			falseStr: "false",
			flowCollectionPadding: !0,
			indentSeq: !0,
			lineWidth: 80,
			minContentWidth: 20,
			nullStr: "null",
			simpleKeys: !1,
			singleQuote: null,
			trailingComma: !1,
			trueStr: "true",
			verifyAliasOrder: !0
		}, doc.schema.toStringOptions, options), inFlow;
		switch (opt.collectionStyle) {
			case "block":
				inFlow = !1;
				break;
			case "flow":
				inFlow = !0;
				break;
			default: inFlow = null;
		}
		return {
			anchors: new Set(),
			doc,
			flowCollectionPadding: opt.flowCollectionPadding ? " " : "",
			indent: "",
			indentStep: typeof opt.indent == "number" ? " ".repeat(opt.indent) : "  ",
			inFlow,
			options: opt
		};
	}
	function getTagObject(tags, item) {
		if (item.tag) {
			let match = tags.filter((t) => t.tag === item.tag);
			if (match.length > 0) return match.find((t) => t.format === item.format) ?? match[0];
		}
		let tagObj, obj;
		if (identity.isScalar(item)) {
			obj = item.value;
			let match = tags.filter((t) => t.identify?.(obj));
			if (match.length > 1) {
				let testMatch = match.filter((t) => t.test);
				testMatch.length > 0 && (match = testMatch);
			}
			tagObj = match.find((t) => t.format === item.format) ?? match.find((t) => !t.format);
		} else obj = item, tagObj = tags.find((t) => t.nodeClass && obj instanceof t.nodeClass);
		if (!tagObj) {
			let name = obj?.constructor?.name ?? (obj === null ? "null" : typeof obj);
			throw Error(`Tag not resolved for ${name} value`);
		}
		return tagObj;
	}
	function stringifyProps(node, tagObj, { anchors: anchors$1, doc }) {
		if (!doc.directives) return "";
		let props = [], anchor = (identity.isScalar(node) || identity.isCollection(node)) && node.anchor;
		anchor && anchors.anchorIsValid(anchor) && (anchors$1.add(anchor), props.push(`&${anchor}`));
		let tag = node.tag ?? (tagObj.default ? null : tagObj.tag);
		return tag && props.push(doc.directives.tagString(tag)), props.join(" ");
	}
	function stringify(item, ctx, onComment, onChompKeep) {
		if (identity.isPair(item)) return item.toString(ctx, onComment, onChompKeep);
		if (identity.isAlias(item)) {
			if (ctx.doc.directives) return item.toString(ctx);
			if (ctx.resolvedAliases?.has(item)) throw TypeError("Cannot stringify circular structure without alias nodes");
			ctx.resolvedAliases ? ctx.resolvedAliases.add(item) : ctx.resolvedAliases = new Set([item]), item = item.resolve(ctx.doc);
		}
		let tagObj, node = identity.isNode(item) ? item : ctx.doc.createNode(item, { onTagObj: (o) => tagObj = o });
		tagObj ??= getTagObject(ctx.doc.schema.tags, node);
		let props = stringifyProps(node, tagObj, ctx);
		props.length > 0 && (ctx.indentAtStart = (ctx.indentAtStart ?? 0) + props.length + 1);
		let str = typeof tagObj.stringify == "function" ? tagObj.stringify(node, ctx, onComment, onChompKeep) : identity.isScalar(node) ? stringifyString.stringifyString(node, ctx, onComment, onChompKeep) : node.toString(ctx, onComment, onChompKeep);
		return props ? identity.isScalar(node) || str[0] === "{" || str[0] === "[" ? `${props} ${str}` : `${props}\n${ctx.indent}${str}` : str;
	}
	exports.createStringifyContext = createStringifyContext, exports.stringify = stringify;
})), require_stringifyPair = __commonJSMin(((exports) => {
	var identity = require_identity(), Scalar = require_Scalar(), stringify = require_stringify(), stringifyComment = require_stringifyComment();
	function stringifyPair({ key, value }, ctx, onComment, onChompKeep) {
		let { allNullValues, doc, indent, indentStep, options: { commentString, indentSeq, simpleKeys } } = ctx, keyComment = identity.isNode(key) && key.comment || null;
		if (simpleKeys) {
			if (keyComment) throw Error("With simple keys, key nodes cannot have comments");
			if (identity.isCollection(key) || !identity.isNode(key) && typeof key == "object") throw Error("With simple keys, collection cannot be used as a key value");
		}
		let explicitKey = !simpleKeys && (!key || keyComment && value == null && !ctx.inFlow || identity.isCollection(key) || (identity.isScalar(key) ? key.type === Scalar.Scalar.BLOCK_FOLDED || key.type === Scalar.Scalar.BLOCK_LITERAL : typeof key == "object"));
		ctx = Object.assign({}, ctx, {
			allNullValues: !1,
			implicitKey: !explicitKey && (simpleKeys || !allNullValues),
			indent: indent + indentStep
		});
		let keyCommentDone = !1, chompKeep = !1, str = stringify.stringify(key, ctx, () => keyCommentDone = !0, () => chompKeep = !0);
		if (!explicitKey && !ctx.inFlow && str.length > 1024) {
			if (simpleKeys) throw Error("With simple keys, single line scalar must not span more than 1024 characters");
			explicitKey = !0;
		}
		if (ctx.inFlow) {
			if (allNullValues || value == null) return keyCommentDone && onComment && onComment(), str === "" ? "?" : explicitKey ? `? ${str}` : str;
		} else if (allNullValues && !simpleKeys || value == null && explicitKey) return str = `? ${str}`, keyComment && !keyCommentDone ? str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment)) : chompKeep && onChompKeep && onChompKeep(), str;
		keyCommentDone && (keyComment = null), explicitKey ? (keyComment && (str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment))), str = `? ${str}\n${indent}:`) : (str = `${str}:`, keyComment && (str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment))));
		let vsb, vcb, valueComment;
		identity.isNode(value) ? (vsb = !!value.spaceBefore, vcb = value.commentBefore, valueComment = value.comment) : (vsb = !1, vcb = null, valueComment = null, value && typeof value == "object" && (value = doc.createNode(value))), ctx.implicitKey = !1, !explicitKey && !keyComment && identity.isScalar(value) && (ctx.indentAtStart = str.length + 1), chompKeep = !1, !indentSeq && indentStep.length >= 2 && !ctx.inFlow && !explicitKey && identity.isSeq(value) && !value.flow && !value.tag && !value.anchor && (ctx.indent = ctx.indent.substring(2));
		let valueCommentDone = !1, valueStr = stringify.stringify(value, ctx, () => valueCommentDone = !0, () => chompKeep = !0), ws = " ";
		if (keyComment || vsb || vcb) {
			if (ws = vsb ? "\n" : "", vcb) {
				let cs = commentString(vcb);
				ws += `\n${stringifyComment.indentComment(cs, ctx.indent)}`;
			}
			valueStr === "" && !ctx.inFlow ? ws === "\n" && valueComment && (ws = "\n\n") : ws += `\n${ctx.indent}`;
		} else if (!explicitKey && identity.isCollection(value)) {
			let vs0 = valueStr[0], nl0 = valueStr.indexOf("\n"), hasNewline = nl0 !== -1, flow = ctx.inFlow ?? value.flow ?? value.items.length === 0;
			if (hasNewline || !flow) {
				let hasPropsLine = !1;
				if (hasNewline && (vs0 === "&" || vs0 === "!")) {
					let sp0 = valueStr.indexOf(" ");
					vs0 === "&" && sp0 !== -1 && sp0 < nl0 && valueStr[sp0 + 1] === "!" && (sp0 = valueStr.indexOf(" ", sp0 + 1)), (sp0 === -1 || nl0 < sp0) && (hasPropsLine = !0);
				}
				hasPropsLine || (ws = `\n${ctx.indent}`);
			}
		} else (valueStr === "" || valueStr[0] === "\n") && (ws = "");
		return str += ws + valueStr, ctx.inFlow ? valueCommentDone && onComment && onComment() : valueComment && !valueCommentDone ? str += stringifyComment.lineComment(str, ctx.indent, commentString(valueComment)) : chompKeep && onChompKeep && onChompKeep(), str;
	}
	exports.stringifyPair = stringifyPair;
})), require_log = __commonJSMin(((exports) => {
	var node_process$2 = require("process");
	function debug(logLevel, ...messages) {
		logLevel === "debug" && console.log(...messages);
	}
	function warn(logLevel, warning) {
		(logLevel === "debug" || logLevel === "warn") && (typeof node_process$2.emitWarning == "function" ? node_process$2.emitWarning(warning) : console.warn(warning));
	}
	exports.debug = debug, exports.warn = warn;
})), require_merge = __commonJSMin(((exports) => {
	var identity = require_identity(), Scalar = require_Scalar();
	let merge = {
		identify: (value) => value === "<<" || typeof value == "symbol" && value.description === "<<",
		default: "key",
		tag: "tag:yaml.org,2002:merge",
		test: /^<<$/,
		resolve: () => Object.assign(new Scalar.Scalar(Symbol("<<")), { addToJSMap: addMergeToJSMap }),
		stringify: () => "<<"
	}, isMergeKey = (ctx, key) => (merge.identify(key) || identity.isScalar(key) && (!key.type || key.type === Scalar.Scalar.PLAIN) && merge.identify(key.value)) && ctx?.doc.schema.tags.some((tag) => tag.tag === merge.tag && tag.default);
	function addMergeToJSMap(ctx, map, value) {
		let source = resolveAliasValue(ctx, value);
		if (identity.isSeq(source)) for (let it of source.items) mergeValue(ctx, map, it);
		else if (Array.isArray(source)) for (let it of source) mergeValue(ctx, map, it);
		else mergeValue(ctx, map, source);
	}
	function mergeValue(ctx, map, value) {
		let source = resolveAliasValue(ctx, value);
		if (!identity.isMap(source)) throw Error("Merge sources must be maps or map aliases");
		let srcMap = source.toJSON(null, ctx, Map);
		for (let [key, value] of srcMap) map instanceof Map ? map.has(key) || map.set(key, value) : map instanceof Set ? map.add(key) : Object.prototype.hasOwnProperty.call(map, key) || Object.defineProperty(map, key, {
			value,
			writable: !0,
			enumerable: !0,
			configurable: !0
		});
		return map;
	}
	function resolveAliasValue(ctx, value) {
		return ctx && identity.isAlias(value) ? value.resolve(ctx.doc, ctx) : value;
	}
	exports.addMergeToJSMap = addMergeToJSMap, exports.isMergeKey = isMergeKey, exports.merge = merge;
})), require_addPairToJSMap = __commonJSMin(((exports) => {
	var log = require_log(), merge = require_merge(), stringify = require_stringify(), identity = require_identity(), toJS = require_toJS();
	function addPairToJSMap(ctx, map, { key, value }) {
		if (identity.isNode(key) && key.addToJSMap) key.addToJSMap(ctx, map, value);
		else if (merge.isMergeKey(ctx, key)) merge.addMergeToJSMap(ctx, map, value);
		else {
			let jsKey = toJS.toJS(key, "", ctx);
			if (map instanceof Map) map.set(jsKey, toJS.toJS(value, jsKey, ctx));
			else if (map instanceof Set) map.add(jsKey);
			else {
				let stringKey = stringifyKey(key, jsKey, ctx), jsValue = toJS.toJS(value, stringKey, ctx);
				stringKey in map ? Object.defineProperty(map, stringKey, {
					value: jsValue,
					writable: !0,
					enumerable: !0,
					configurable: !0
				}) : map[stringKey] = jsValue;
			}
		}
		return map;
	}
	function stringifyKey(key, jsKey, ctx) {
		if (jsKey === null) return "";
		if (typeof jsKey != "object") return String(jsKey);
		if (identity.isNode(key) && ctx?.doc) {
			let strCtx = stringify.createStringifyContext(ctx.doc, {});
			strCtx.anchors = new Set();
			for (let node of ctx.anchors.keys()) strCtx.anchors.add(node.anchor);
			strCtx.inFlow = !0, strCtx.inStringifyKey = !0;
			let strKey = key.toString(strCtx);
			if (!ctx.mapKeyWarned) {
				let jsonStr = JSON.stringify(strKey);
				jsonStr.length > 40 && (jsonStr = jsonStr.substring(0, 36) + "...\""), log.warn(ctx.doc.options.logLevel, `Keys with collection values will be stringified due to JS Object restrictions: ${jsonStr}. Set mapAsMap: true to use object keys.`), ctx.mapKeyWarned = !0;
			}
			return strKey;
		}
		return JSON.stringify(jsKey);
	}
	exports.addPairToJSMap = addPairToJSMap;
})), require_Pair = __commonJSMin(((exports) => {
	var createNode = require_createNode(), stringifyPair = require_stringifyPair(), addPairToJSMap = require_addPairToJSMap(), identity = require_identity();
	function createPair(key, value, ctx) {
		return new Pair(createNode.createNode(key, void 0, ctx), createNode.createNode(value, void 0, ctx));
	}
	var Pair = class Pair {
		constructor(key, value = null) {
			Object.defineProperty(this, identity.NODE_TYPE, { value: identity.PAIR }), this.key = key, this.value = value;
		}
		clone(schema) {
			let { key, value } = this;
			return identity.isNode(key) && (key = key.clone(schema)), identity.isNode(value) && (value = value.clone(schema)), new Pair(key, value);
		}
		toJSON(_, ctx) {
			let pair = ctx?.mapAsMap ? new Map() : {};
			return addPairToJSMap.addPairToJSMap(ctx, pair, this);
		}
		toString(ctx, onComment, onChompKeep) {
			return ctx?.doc ? stringifyPair.stringifyPair(this, ctx, onComment, onChompKeep) : JSON.stringify(this);
		}
	};
	exports.Pair = Pair, exports.createPair = createPair;
})), require_stringifyCollection = __commonJSMin(((exports) => {
	var identity = require_identity(), stringify = require_stringify(), stringifyComment = require_stringifyComment();
	function stringifyCollection(collection, ctx, options) {
		return (ctx.inFlow ?? collection.flow ? stringifyFlowCollection : stringifyBlockCollection)(collection, ctx, options);
	}
	function stringifyBlockCollection({ comment, items }, ctx, { blockItemPrefix, flowChars, itemIndent, onChompKeep, onComment }) {
		let { indent, options: { commentString } } = ctx, itemCtx = Object.assign({}, ctx, {
			indent: itemIndent,
			type: null
		}), chompKeep = !1, lines = [];
		for (let i = 0; i < items.length; ++i) {
			let item = items[i], comment = null;
			if (identity.isNode(item)) !chompKeep && item.spaceBefore && lines.push(""), addCommentBefore(ctx, lines, item.commentBefore, chompKeep), item.comment && (comment = item.comment);
			else if (identity.isPair(item)) {
				let ik = identity.isNode(item.key) ? item.key : null;
				ik && (!chompKeep && ik.spaceBefore && lines.push(""), addCommentBefore(ctx, lines, ik.commentBefore, chompKeep));
			}
			chompKeep = !1;
			let str = stringify.stringify(item, itemCtx, () => comment = null, () => chompKeep = !0);
			comment && (str += stringifyComment.lineComment(str, itemIndent, commentString(comment))), chompKeep && comment && (chompKeep = !1), lines.push(blockItemPrefix + str);
		}
		let str;
		if (lines.length === 0) str = flowChars.start + flowChars.end;
		else {
			str = lines[0];
			for (let i = 1; i < lines.length; ++i) {
				let line = lines[i];
				str += line ? `\n${indent}${line}` : "\n";
			}
		}
		return comment ? (str += "\n" + stringifyComment.indentComment(commentString(comment), indent), onComment && onComment()) : chompKeep && onChompKeep && onChompKeep(), str;
	}
	function stringifyFlowCollection({ items }, ctx, { flowChars, itemIndent }) {
		let { indent, indentStep, flowCollectionPadding: fcPadding, options: { commentString } } = ctx;
		itemIndent += indentStep;
		let itemCtx = Object.assign({}, ctx, {
			indent: itemIndent,
			inFlow: !0,
			type: null
		}), reqNewline = !1, linesAtValue = 0, lines = [];
		for (let i = 0; i < items.length; ++i) {
			let item = items[i], comment = null;
			if (identity.isNode(item)) item.spaceBefore && lines.push(""), addCommentBefore(ctx, lines, item.commentBefore, !1), item.comment && (comment = item.comment);
			else if (identity.isPair(item)) {
				let ik = identity.isNode(item.key) ? item.key : null;
				ik && (ik.spaceBefore && lines.push(""), addCommentBefore(ctx, lines, ik.commentBefore, !1), ik.comment && (reqNewline = !0));
				let iv = identity.isNode(item.value) ? item.value : null;
				iv ? (iv.comment && (comment = iv.comment), iv.commentBefore && (reqNewline = !0)) : item.value == null && ik?.comment && (comment = ik.comment);
			}
			comment && (reqNewline = !0);
			let str = stringify.stringify(item, itemCtx, () => comment = null);
			reqNewline ||= lines.length > linesAtValue || str.includes("\n"), i < items.length - 1 ? str += "," : ctx.options.trailingComma && (ctx.options.lineWidth > 0 && (reqNewline ||= lines.reduce((sum, line) => sum + line.length + 2, 2) + (str.length + 2) > ctx.options.lineWidth), reqNewline && (str += ",")), comment && (str += stringifyComment.lineComment(str, itemIndent, commentString(comment))), lines.push(str), linesAtValue = lines.length;
		}
		let { start, end } = flowChars;
		if (lines.length === 0) return start + end;
		if (!reqNewline) {
			let len = lines.reduce((sum, line) => sum + line.length + 2, 2);
			reqNewline = ctx.options.lineWidth > 0 && len > ctx.options.lineWidth;
		}
		if (reqNewline) {
			let str = start;
			for (let line of lines) str += line ? `\n${indentStep}${indent}${line}` : "\n";
			return `${str}\n${indent}${end}`;
		}
		return `${start}${fcPadding}${lines.join(" ")}${fcPadding}${end}`;
	}
	function addCommentBefore({ indent, options: { commentString } }, lines, comment, chompKeep) {
		if (comment && chompKeep && (comment = comment.replace(/^\n+/, "")), comment) {
			let ic = stringifyComment.indentComment(commentString(comment), indent);
			lines.push(ic.trimStart());
		}
	}
	exports.stringifyCollection = stringifyCollection;
})), require_YAMLMap = __commonJSMin(((exports) => {
	var stringifyCollection = require_stringifyCollection(), addPairToJSMap = require_addPairToJSMap(), Collection = require_Collection(), identity = require_identity(), Pair = require_Pair(), Scalar = require_Scalar();
	function findPair(items, key) {
		let k = identity.isScalar(key) ? key.value : key;
		for (let it of items) if (identity.isPair(it) && (it.key === key || it.key === k || identity.isScalar(it.key) && it.key.value === k)) return it;
	}
	exports.YAMLMap = class extends Collection.Collection {
		static get tagName() {
			return "tag:yaml.org,2002:map";
		}
		constructor(schema) {
			super(identity.MAP, schema), this.items = [];
		}
		static from(schema, obj, ctx) {
			let { keepUndefined, replacer } = ctx, map = new this(schema), add = (key, value) => {
				if (typeof replacer == "function") value = replacer.call(obj, key, value);
				else if (Array.isArray(replacer) && !replacer.includes(key)) return;
				(value !== void 0 || keepUndefined) && map.items.push(Pair.createPair(key, value, ctx));
			};
			if (obj instanceof Map) for (let [key, value] of obj) add(key, value);
			else if (obj && typeof obj == "object") for (let key of Object.keys(obj)) add(key, obj[key]);
			return typeof schema.sortMapEntries == "function" && map.items.sort(schema.sortMapEntries), map;
		}
		add(pair, overwrite) {
			let _pair;
			_pair = identity.isPair(pair) ? pair : !pair || typeof pair != "object" || !("key" in pair) ? new Pair.Pair(pair, pair?.value) : new Pair.Pair(pair.key, pair.value);
			let prev = findPair(this.items, _pair.key), sortEntries = this.schema?.sortMapEntries;
			if (prev) {
				if (!overwrite) throw Error(`Key ${_pair.key} already set`);
				identity.isScalar(prev.value) && Scalar.isScalarValue(_pair.value) ? prev.value.value = _pair.value : prev.value = _pair.value;
			} else if (sortEntries) {
				let i = this.items.findIndex((item) => sortEntries(_pair, item) < 0);
				i === -1 ? this.items.push(_pair) : this.items.splice(i, 0, _pair);
			} else this.items.push(_pair);
		}
		delete(key) {
			let it = findPair(this.items, key);
			return it ? this.items.splice(this.items.indexOf(it), 1).length > 0 : !1;
		}
		get(key, keepScalar) {
			let node = findPair(this.items, key)?.value;
			return (!keepScalar && identity.isScalar(node) ? node.value : node) ?? void 0;
		}
		has(key) {
			return !!findPair(this.items, key);
		}
		set(key, value) {
			this.add(new Pair.Pair(key, value), !0);
		}
		toJSON(_, ctx, Type) {
			let map = Type ? new Type() : ctx?.mapAsMap ? new Map() : {};
			ctx?.onCreate && ctx.onCreate(map);
			for (let item of this.items) addPairToJSMap.addPairToJSMap(ctx, map, item);
			return map;
		}
		toString(ctx, onComment, onChompKeep) {
			if (!ctx) return JSON.stringify(this);
			for (let item of this.items) if (!identity.isPair(item)) throw Error(`Map items must all be pairs; found ${JSON.stringify(item)} instead`);
			return !ctx.allNullValues && this.hasAllNullValues(!1) && (ctx = Object.assign({}, ctx, { allNullValues: !0 })), stringifyCollection.stringifyCollection(this, ctx, {
				blockItemPrefix: "",
				flowChars: {
					start: "{",
					end: "}"
				},
				itemIndent: ctx.indent || "",
				onChompKeep,
				onComment
			});
		}
	}, exports.findPair = findPair;
})), require_map = __commonJSMin(((exports) => {
	var identity = require_identity(), YAMLMap = require_YAMLMap();
	exports.map = {
		collection: "map",
		default: !0,
		nodeClass: YAMLMap.YAMLMap,
		tag: "tag:yaml.org,2002:map",
		resolve(map, onError) {
			return identity.isMap(map) || onError("Expected a mapping for this tag"), map;
		},
		createNode: (schema, obj, ctx) => YAMLMap.YAMLMap.from(schema, obj, ctx)
	};
})), require_YAMLSeq = __commonJSMin(((exports) => {
	var createNode = require_createNode(), stringifyCollection = require_stringifyCollection(), Collection = require_Collection(), identity = require_identity(), Scalar = require_Scalar(), toJS = require_toJS(), YAMLSeq = class extends Collection.Collection {
		static get tagName() {
			return "tag:yaml.org,2002:seq";
		}
		constructor(schema) {
			super(identity.SEQ, schema), this.items = [];
		}
		add(value) {
			this.items.push(value);
		}
		delete(key) {
			let idx = asItemIndex(key);
			return typeof idx == "number" && this.items.splice(idx, 1).length > 0;
		}
		get(key, keepScalar) {
			let idx = asItemIndex(key);
			if (typeof idx != "number") return;
			let it = this.items[idx];
			return !keepScalar && identity.isScalar(it) ? it.value : it;
		}
		has(key) {
			let idx = asItemIndex(key);
			return typeof idx == "number" && idx < this.items.length;
		}
		set(key, value) {
			let idx = asItemIndex(key);
			if (typeof idx != "number") throw Error(`Expected a valid index, not ${key}.`);
			let prev = this.items[idx];
			identity.isScalar(prev) && Scalar.isScalarValue(value) ? prev.value = value : this.items[idx] = value;
		}
		toJSON(_, ctx) {
			let seq = [];
			ctx?.onCreate && ctx.onCreate(seq);
			let i = 0;
			for (let item of this.items) seq.push(toJS.toJS(item, String(i++), ctx));
			return seq;
		}
		toString(ctx, onComment, onChompKeep) {
			return ctx ? stringifyCollection.stringifyCollection(this, ctx, {
				blockItemPrefix: "- ",
				flowChars: {
					start: "[",
					end: "]"
				},
				itemIndent: (ctx.indent || "") + "  ",
				onChompKeep,
				onComment
			}) : JSON.stringify(this);
		}
		static from(schema, obj, ctx) {
			let { replacer } = ctx, seq = new this(schema);
			if (obj && Symbol.iterator in Object(obj)) {
				let i = 0;
				for (let it of obj) {
					if (typeof replacer == "function") {
						let key = obj instanceof Set ? it : String(i++);
						it = replacer.call(obj, key, it);
					}
					seq.items.push(createNode.createNode(it, void 0, ctx));
				}
			}
			return seq;
		}
	};
	function asItemIndex(key) {
		let idx = identity.isScalar(key) ? key.value : key;
		return idx && typeof idx == "string" && (idx = Number(idx)), typeof idx == "number" && Number.isInteger(idx) && idx >= 0 ? idx : null;
	}
	exports.YAMLSeq = YAMLSeq;
})), require_seq = __commonJSMin(((exports) => {
	var identity = require_identity(), YAMLSeq = require_YAMLSeq();
	exports.seq = {
		collection: "seq",
		default: !0,
		nodeClass: YAMLSeq.YAMLSeq,
		tag: "tag:yaml.org,2002:seq",
		resolve(seq, onError) {
			return identity.isSeq(seq) || onError("Expected a sequence for this tag"), seq;
		},
		createNode: (schema, obj, ctx) => YAMLSeq.YAMLSeq.from(schema, obj, ctx)
	};
})), require_string = __commonJSMin(((exports) => {
	var stringifyString = require_stringifyString();
	exports.string = {
		identify: (value) => typeof value == "string",
		default: !0,
		tag: "tag:yaml.org,2002:str",
		resolve: (str) => str,
		stringify(item, ctx, onComment, onChompKeep) {
			return ctx = Object.assign({ actualString: !0 }, ctx), stringifyString.stringifyString(item, ctx, onComment, onChompKeep);
		}
	};
})), require_null = __commonJSMin(((exports) => {
	var Scalar = require_Scalar();
	let nullTag = {
		identify: (value) => value == null,
		createNode: () => new Scalar.Scalar(null),
		default: !0,
		tag: "tag:yaml.org,2002:null",
		test: /^(?:~|[Nn]ull|NULL)?$/,
		resolve: () => new Scalar.Scalar(null),
		stringify: ({ source }, ctx) => typeof source == "string" && nullTag.test.test(source) ? source : ctx.options.nullStr
	};
	exports.nullTag = nullTag;
})), require_bool$1 = __commonJSMin(((exports) => {
	var Scalar = require_Scalar();
	let boolTag = {
		identify: (value) => typeof value == "boolean",
		default: !0,
		tag: "tag:yaml.org,2002:bool",
		test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
		resolve: (str) => new Scalar.Scalar(str[0] === "t" || str[0] === "T"),
		stringify({ source, value }, ctx) {
			return source && boolTag.test.test(source) && value === (source[0] === "t" || source[0] === "T") ? source : value ? ctx.options.trueStr : ctx.options.falseStr;
		}
	};
	exports.boolTag = boolTag;
})), require_stringifyNumber = __commonJSMin(((exports) => {
	function stringifyNumber({ format, minFractionDigits, tag, value }) {
		if (typeof value == "bigint") return String(value);
		let num = typeof value == "number" ? value : Number(value);
		if (!isFinite(num)) return isNaN(num) ? ".nan" : num < 0 ? "-.inf" : ".inf";
		let n = Object.is(value, -0) ? "-0" : JSON.stringify(value);
		if (!format && minFractionDigits && (!tag || tag === "tag:yaml.org,2002:float") && /^-?\d/.test(n) && !n.includes("e")) {
			let i = n.indexOf(".");
			i < 0 && (i = n.length, n += ".");
			let d = minFractionDigits - (n.length - i - 1);
			for (; d-- > 0;) n += "0";
		}
		return n;
	}
	exports.stringifyNumber = stringifyNumber;
})), require_float$1 = __commonJSMin(((exports) => {
	var Scalar = require_Scalar(), stringifyNumber = require_stringifyNumber();
	let floatNaN = {
		identify: (value) => typeof value == "number",
		default: !0,
		tag: "tag:yaml.org,2002:float",
		test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
		resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? -Infinity : Infinity,
		stringify: stringifyNumber.stringifyNumber
	};
	exports.float = {
		identify: (value) => typeof value == "number",
		default: !0,
		tag: "tag:yaml.org,2002:float",
		test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
		resolve(str) {
			let node = new Scalar.Scalar(parseFloat(str)), dot = str.indexOf(".");
			return dot !== -1 && str[str.length - 1] === "0" && (node.minFractionDigits = str.length - dot - 1), node;
		},
		stringify: stringifyNumber.stringifyNumber
	}, exports.floatExp = {
		identify: (value) => typeof value == "number",
		default: !0,
		tag: "tag:yaml.org,2002:float",
		format: "EXP",
		test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
		resolve: (str) => parseFloat(str),
		stringify(node) {
			let num = Number(node.value);
			return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
		}
	}, exports.floatNaN = floatNaN;
})), require_int$1 = __commonJSMin(((exports) => {
	var stringifyNumber = require_stringifyNumber();
	let intIdentify = (value) => typeof value == "bigint" || Number.isInteger(value), intResolve = (str, offset, radix, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str.substring(offset), radix);
	function intStringify(node, radix, prefix) {
		let { value } = node;
		return intIdentify(value) && value >= 0 ? prefix + value.toString(radix) : stringifyNumber.stringifyNumber(node);
	}
	exports.int = {
		identify: intIdentify,
		default: !0,
		tag: "tag:yaml.org,2002:int",
		test: /^[-+]?[0-9]+$/,
		resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
		stringify: stringifyNumber.stringifyNumber
	}, exports.intHex = {
		identify: (value) => intIdentify(value) && value >= 0,
		default: !0,
		tag: "tag:yaml.org,2002:int",
		format: "HEX",
		test: /^0x[0-9a-fA-F]+$/,
		resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
		stringify: (node) => intStringify(node, 16, "0x")
	}, exports.intOct = {
		identify: (value) => intIdentify(value) && value >= 0,
		default: !0,
		tag: "tag:yaml.org,2002:int",
		format: "OCT",
		test: /^0o[0-7]+$/,
		resolve: (str, _onError, opt) => intResolve(str, 2, 8, opt),
		stringify: (node) => intStringify(node, 8, "0o")
	};
})), require_schema$2 = __commonJSMin(((exports) => {
	var map = require_map(), _null = require_null(), seq = require_seq(), string = require_string(), bool = require_bool$1(), float = require_float$1(), int = require_int$1();
	exports.schema = [
		map.map,
		seq.seq,
		string.string,
		_null.nullTag,
		bool.boolTag,
		int.intOct,
		int.int,
		int.intHex,
		float.floatNaN,
		float.floatExp,
		float.float
	];
})), require_schema$1 = __commonJSMin(((exports) => {
	var Scalar = require_Scalar(), map = require_map(), seq = require_seq();
	function intIdentify(value) {
		return typeof value == "bigint" || Number.isInteger(value);
	}
	let stringifyJSON = ({ value }) => JSON.stringify(value), jsonScalars = [
		{
			identify: (value) => typeof value == "string",
			default: !0,
			tag: "tag:yaml.org,2002:str",
			resolve: (str) => str,
			stringify: stringifyJSON
		},
		{
			identify: (value) => value == null,
			createNode: () => new Scalar.Scalar(null),
			default: !0,
			tag: "tag:yaml.org,2002:null",
			test: /^null$/,
			resolve: () => null,
			stringify: stringifyJSON
		},
		{
			identify: (value) => typeof value == "boolean",
			default: !0,
			tag: "tag:yaml.org,2002:bool",
			test: /^true$|^false$/,
			resolve: (str) => str === "true",
			stringify: stringifyJSON
		},
		{
			identify: intIdentify,
			default: !0,
			tag: "tag:yaml.org,2002:int",
			test: /^-?(?:0|[1-9][0-9]*)$/,
			resolve: (str, _onError, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str, 10),
			stringify: ({ value }) => intIdentify(value) ? value.toString() : JSON.stringify(value)
		},
		{
			identify: (value) => typeof value == "number",
			default: !0,
			tag: "tag:yaml.org,2002:float",
			test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
			resolve: (str) => parseFloat(str),
			stringify: stringifyJSON
		}
	];
	exports.schema = [map.map, seq.seq].concat(jsonScalars, {
		default: !0,
		tag: "",
		test: /^/,
		resolve(str, onError) {
			return onError(`Unresolved plain scalar ${JSON.stringify(str)}`), str;
		}
	});
})), require_binary = __commonJSMin(((exports) => {
	var node_buffer = require("buffer"), Scalar = require_Scalar(), stringifyString = require_stringifyString();
	exports.binary = {
		identify: (value) => value instanceof Uint8Array,
		default: !1,
		tag: "tag:yaml.org,2002:binary",
		resolve(src, onError) {
			if (typeof node_buffer.Buffer == "function") return node_buffer.Buffer.from(src, "base64");
			if (typeof atob == "function") {
				let str = atob(src.replace(/[\n\r]/g, "")), buffer = new Uint8Array(str.length);
				for (let i = 0; i < str.length; ++i) buffer[i] = str.charCodeAt(i);
				return buffer;
			}
			return onError("This environment does not support reading binary tags; either Buffer or atob is required"), src;
		},
		stringify({ comment, type, value }, ctx, onComment, onChompKeep) {
			if (!value) return "";
			let buf = value, str;
			if (typeof node_buffer.Buffer == "function") str = buf instanceof node_buffer.Buffer ? buf.toString("base64") : node_buffer.Buffer.from(buf.buffer).toString("base64");
			else if (typeof btoa == "function") {
				let s = "";
				for (let i = 0; i < buf.length; ++i) s += String.fromCharCode(buf[i]);
				str = btoa(s);
			} else throw Error("This environment does not support writing binary tags; either Buffer or btoa is required");
			if (type ??= Scalar.Scalar.BLOCK_LITERAL, type !== Scalar.Scalar.QUOTE_DOUBLE) {
				let lineWidth = Math.max(ctx.options.lineWidth - ctx.indent.length, ctx.options.minContentWidth), n = Math.ceil(str.length / lineWidth), lines = Array(n);
				for (let i = 0, o = 0; i < n; ++i, o += lineWidth) lines[i] = str.substr(o, lineWidth);
				str = lines.join(type === Scalar.Scalar.BLOCK_LITERAL ? "\n" : " ");
			}
			return stringifyString.stringifyString({
				comment,
				type,
				value: str
			}, ctx, onComment, onChompKeep);
		}
	};
})), require_pairs = __commonJSMin(((exports) => {
	var identity = require_identity(), Pair = require_Pair(), Scalar = require_Scalar(), YAMLSeq = require_YAMLSeq();
	function resolvePairs(seq, onError) {
		if (identity.isSeq(seq)) for (let i = 0; i < seq.items.length; ++i) {
			let item = seq.items[i];
			if (!identity.isPair(item)) {
				if (identity.isMap(item)) {
					item.items.length > 1 && onError("Each pair must have its own sequence indicator");
					let pair = item.items[0] || new Pair.Pair(new Scalar.Scalar(null));
					if (item.commentBefore && (pair.key.commentBefore = pair.key.commentBefore ? `${item.commentBefore}\n${pair.key.commentBefore}` : item.commentBefore), item.comment) {
						let cn = pair.value ?? pair.key;
						cn.comment = cn.comment ? `${item.comment}\n${cn.comment}` : item.comment;
					}
					item = pair;
				}
				seq.items[i] = identity.isPair(item) ? item : new Pair.Pair(item);
			}
		}
		else onError("Expected a sequence for this tag");
		return seq;
	}
	function createPairs(schema, iterable, ctx) {
		let { replacer } = ctx, pairs = new YAMLSeq.YAMLSeq(schema);
		pairs.tag = "tag:yaml.org,2002:pairs";
		let i = 0;
		if (iterable && Symbol.iterator in Object(iterable)) for (let it of iterable) {
			typeof replacer == "function" && (it = replacer.call(iterable, String(i++), it));
			let key, value;
			if (Array.isArray(it)) {
				if (it.length === 2) key = it[0], value = it[1];
				else throw TypeError(`Expected [key, value] tuple: ${it}`);
			} else if (it && it instanceof Object) {
				let keys = Object.keys(it);
				if (keys.length === 1) key = keys[0], value = it[key];
				else throw TypeError(`Expected tuple with one key, not ${keys.length} keys`);
			} else key = it;
			pairs.items.push(Pair.createPair(key, value, ctx));
		}
		return pairs;
	}
	let pairs = {
		collection: "seq",
		default: !1,
		tag: "tag:yaml.org,2002:pairs",
		resolve: resolvePairs,
		createNode: createPairs
	};
	exports.createPairs = createPairs, exports.pairs = pairs, exports.resolvePairs = resolvePairs;
})), require_omap = __commonJSMin(((exports) => {
	var identity = require_identity(), toJS = require_toJS(), YAMLMap = require_YAMLMap(), YAMLSeq = require_YAMLSeq(), pairs = require_pairs(), YAMLOMap = class YAMLOMap extends YAMLSeq.YAMLSeq {
		constructor() {
			super(), this.add = YAMLMap.YAMLMap.prototype.add.bind(this), this.delete = YAMLMap.YAMLMap.prototype.delete.bind(this), this.get = YAMLMap.YAMLMap.prototype.get.bind(this), this.has = YAMLMap.YAMLMap.prototype.has.bind(this), this.set = YAMLMap.YAMLMap.prototype.set.bind(this), this.tag = YAMLOMap.tag;
		}
		toJSON(_, ctx) {
			if (!ctx) return super.toJSON(_);
			let map = new Map();
			ctx?.onCreate && ctx.onCreate(map);
			for (let pair of this.items) {
				let key, value;
				if (identity.isPair(pair) ? (key = toJS.toJS(pair.key, "", ctx), value = toJS.toJS(pair.value, key, ctx)) : key = toJS.toJS(pair, "", ctx), map.has(key)) throw Error("Ordered maps must not include duplicate keys");
				map.set(key, value);
			}
			return map;
		}
		static from(schema, iterable, ctx) {
			let pairs$1 = pairs.createPairs(schema, iterable, ctx), omap = new this();
			return omap.items = pairs$1.items, omap;
		}
	};
	YAMLOMap.tag = "tag:yaml.org,2002:omap";
	let omap = {
		collection: "seq",
		identify: (value) => value instanceof Map,
		nodeClass: YAMLOMap,
		default: !1,
		tag: "tag:yaml.org,2002:omap",
		resolve(seq, onError) {
			let pairs$1 = pairs.resolvePairs(seq, onError), seenKeys = [];
			for (let { key } of pairs$1.items) identity.isScalar(key) && (seenKeys.includes(key.value) ? onError(`Ordered maps must not include duplicate keys: ${key.value}`) : seenKeys.push(key.value));
			return Object.assign(new YAMLOMap(), pairs$1);
		},
		createNode: (schema, iterable, ctx) => YAMLOMap.from(schema, iterable, ctx)
	};
	exports.YAMLOMap = YAMLOMap, exports.omap = omap;
})), require_bool = __commonJSMin(((exports) => {
	var Scalar = require_Scalar();
	function boolStringify({ value, source }, ctx) {
		return source && (value ? trueTag : falseTag).test.test(source) ? source : value ? ctx.options.trueStr : ctx.options.falseStr;
	}
	let trueTag = {
		identify: (value) => value === !0,
		default: !0,
		tag: "tag:yaml.org,2002:bool",
		test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
		resolve: () => new Scalar.Scalar(!0),
		stringify: boolStringify
	}, falseTag = {
		identify: (value) => value === !1,
		default: !0,
		tag: "tag:yaml.org,2002:bool",
		test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,
		resolve: () => new Scalar.Scalar(!1),
		stringify: boolStringify
	};
	exports.falseTag = falseTag, exports.trueTag = trueTag;
})), require_float = __commonJSMin(((exports) => {
	var Scalar = require_Scalar(), stringifyNumber = require_stringifyNumber();
	let floatNaN = {
		identify: (value) => typeof value == "number",
		default: !0,
		tag: "tag:yaml.org,2002:float",
		test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
		resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? -Infinity : Infinity,
		stringify: stringifyNumber.stringifyNumber
	};
	exports.float = {
		identify: (value) => typeof value == "number",
		default: !0,
		tag: "tag:yaml.org,2002:float",
		test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
		resolve(str) {
			let node = new Scalar.Scalar(parseFloat(str.replace(/_/g, ""))), dot = str.indexOf(".");
			if (dot !== -1) {
				let f = str.substring(dot + 1).replace(/_/g, "");
				f[f.length - 1] === "0" && (node.minFractionDigits = f.length);
			}
			return node;
		},
		stringify: stringifyNumber.stringifyNumber
	}, exports.floatExp = {
		identify: (value) => typeof value == "number",
		default: !0,
		tag: "tag:yaml.org,2002:float",
		format: "EXP",
		test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
		resolve: (str) => parseFloat(str.replace(/_/g, "")),
		stringify(node) {
			let num = Number(node.value);
			return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
		}
	}, exports.floatNaN = floatNaN;
})), require_int = __commonJSMin(((exports) => {
	var stringifyNumber = require_stringifyNumber();
	let intIdentify = (value) => typeof value == "bigint" || Number.isInteger(value);
	function intResolve(str, offset, radix, { intAsBigInt }) {
		let sign = str[0];
		if ((sign === "-" || sign === "+") && (offset += 1), str = str.substring(offset).replace(/_/g, ""), intAsBigInt) {
			switch (radix) {
				case 2:
					str = `0b${str}`;
					break;
				case 8:
					str = `0o${str}`;
					break;
				case 16: str = `0x${str}`;
			}
			let n = BigInt(str);
			return sign === "-" ? BigInt(-1) * n : n;
		}
		let n = parseInt(str, radix);
		return sign === "-" ? -1 * n : n;
	}
	function intStringify(node, radix, prefix) {
		let { value } = node;
		if (intIdentify(value)) {
			let str = value.toString(radix);
			return value < 0 ? "-" + prefix + str.substr(1) : prefix + str;
		}
		return stringifyNumber.stringifyNumber(node);
	}
	let intBin = {
		identify: intIdentify,
		default: !0,
		tag: "tag:yaml.org,2002:int",
		format: "BIN",
		test: /^[-+]?0b[0-1_]+$/,
		resolve: (str, _onError, opt) => intResolve(str, 2, 2, opt),
		stringify: (node) => intStringify(node, 2, "0b")
	}, intOct = {
		identify: intIdentify,
		default: !0,
		tag: "tag:yaml.org,2002:int",
		format: "OCT",
		test: /^[-+]?0[0-7_]+$/,
		resolve: (str, _onError, opt) => intResolve(str, 1, 8, opt),
		stringify: (node) => intStringify(node, 8, "0")
	}, int = {
		identify: intIdentify,
		default: !0,
		tag: "tag:yaml.org,2002:int",
		test: /^[-+]?[0-9][0-9_]*$/,
		resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
		stringify: stringifyNumber.stringifyNumber
	}, intHex = {
		identify: intIdentify,
		default: !0,
		tag: "tag:yaml.org,2002:int",
		format: "HEX",
		test: /^[-+]?0x[0-9a-fA-F_]+$/,
		resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
		stringify: (node) => intStringify(node, 16, "0x")
	};
	exports.int = int, exports.intBin = intBin, exports.intHex = intHex, exports.intOct = intOct;
})), require_set$1 = __commonJSMin(((exports) => {
	var identity = require_identity(), Pair = require_Pair(), YAMLMap = require_YAMLMap(), YAMLSet = class YAMLSet extends YAMLMap.YAMLMap {
		constructor(schema) {
			super(schema), this.tag = YAMLSet.tag;
		}
		add(key) {
			let pair;
			pair = identity.isPair(key) ? key : key && typeof key == "object" && "key" in key && "value" in key && key.value === null ? new Pair.Pair(key.key, null) : new Pair.Pair(key, null), YAMLMap.findPair(this.items, pair.key) || this.items.push(pair);
		}
		get(key, keepPair) {
			let pair = YAMLMap.findPair(this.items, key);
			return !keepPair && identity.isPair(pair) ? identity.isScalar(pair.key) ? pair.key.value : pair.key : pair;
		}
		set(key, value) {
			if (typeof value != "boolean") throw Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof value}`);
			let prev = YAMLMap.findPair(this.items, key);
			prev && !value ? this.items.splice(this.items.indexOf(prev), 1) : !prev && value && this.items.push(new Pair.Pair(key));
		}
		toJSON(_, ctx) {
			return super.toJSON(_, ctx, Set);
		}
		toString(ctx, onComment, onChompKeep) {
			if (!ctx) return JSON.stringify(this);
			if (this.hasAllNullValues(!0)) return super.toString(Object.assign({}, ctx, { allNullValues: !0 }), onComment, onChompKeep);
			throw Error("Set items must all have null values");
		}
		static from(schema, iterable, ctx) {
			let { replacer } = ctx, set = new this(schema);
			if (iterable && Symbol.iterator in Object(iterable)) for (let value of iterable) typeof replacer == "function" && (value = replacer.call(iterable, value, value)), set.items.push(Pair.createPair(value, null, ctx));
			return set;
		}
	};
	YAMLSet.tag = "tag:yaml.org,2002:set";
	let set = {
		collection: "map",
		identify: (value) => value instanceof Set,
		nodeClass: YAMLSet,
		default: !1,
		tag: "tag:yaml.org,2002:set",
		createNode: (schema, iterable, ctx) => YAMLSet.from(schema, iterable, ctx),
		resolve(map, onError) {
			if (identity.isMap(map)) {
				if (map.hasAllNullValues(!0)) return Object.assign(new YAMLSet(), map);
				onError("Set items must all have null values");
			} else onError("Expected a mapping for this tag");
			return map;
		}
	};
	exports.YAMLSet = YAMLSet, exports.set = set;
})), require_timestamp$4 = __commonJSMin(((exports) => {
	var stringifyNumber = require_stringifyNumber();
	function parseSexagesimal(str, asBigInt) {
		let sign = str[0], parts = sign === "-" || sign === "+" ? str.substring(1) : str, num = (n) => asBigInt ? BigInt(n) : Number(n), res = parts.replace(/_/g, "").split(":").reduce((res, p) => res * num(60) + num(p), num(0));
		return sign === "-" ? num(-1) * res : res;
	}
	function stringifySexagesimal(node) {
		let { value } = node, num = (n) => n;
		if (typeof value == "bigint") num = (n) => BigInt(n);
		else if (isNaN(value) || !isFinite(value)) return stringifyNumber.stringifyNumber(node);
		let sign = "";
		value < 0 && (sign = "-", value *= num(-1));
		let _60 = num(60), parts = [value % _60];
		return value < 60 ? parts.unshift(0) : (value = (value - parts[0]) / _60, parts.unshift(value % _60), value >= 60 && (value = (value - parts[0]) / _60, parts.unshift(value))), sign + parts.map((n) => String(n).padStart(2, "0")).join(":").replace(/000000\d*$/, "");
	}
	let intTime = {
		identify: (value) => typeof value == "bigint" || Number.isInteger(value),
		default: !0,
		tag: "tag:yaml.org,2002:int",
		format: "TIME",
		test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
		resolve: (str, _onError, { intAsBigInt }) => parseSexagesimal(str, intAsBigInt),
		stringify: stringifySexagesimal
	}, floatTime = {
		identify: (value) => typeof value == "number",
		default: !0,
		tag: "tag:yaml.org,2002:float",
		format: "TIME",
		test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
		resolve: (str) => parseSexagesimal(str, !1),
		stringify: stringifySexagesimal
	}, timestamp = {
		identify: (value) => value instanceof Date,
		default: !0,
		tag: "tag:yaml.org,2002:timestamp",
		test: RegExp("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:t|T|[ \\t]+)([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?)?$"),
		resolve(str) {
			let match = str.match(timestamp.test);
			if (!match) throw Error("!!timestamp expects a date, starting with yyyy-mm-dd");
			let [, year, month, day, hour, minute, second] = match.map(Number), millisec = match[7] ? Number((match[7] + "00").substr(1, 3)) : 0, date = Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0, millisec), tz = match[8];
			if (tz && tz !== "Z") {
				let d = parseSexagesimal(tz, !1);
				Math.abs(d) < 30 && (d *= 60), date -= 6e4 * d;
			}
			return new Date(date);
		},
		stringify: ({ value }) => value?.toISOString().replace(/(T00:00:00)?\.000Z$/, "") ?? ""
	};
	exports.floatTime = floatTime, exports.intTime = intTime, exports.timestamp = timestamp;
})), require_schema = __commonJSMin(((exports) => {
	var map = require_map(), _null = require_null(), seq = require_seq(), string = require_string(), binary = require_binary(), bool = require_bool(), float = require_float(), int = require_int(), merge = require_merge(), omap = require_omap(), pairs = require_pairs(), set = require_set$1(), timestamp = require_timestamp$4();
	exports.schema = [
		map.map,
		seq.seq,
		string.string,
		_null.nullTag,
		bool.trueTag,
		bool.falseTag,
		int.intBin,
		int.intOct,
		int.int,
		int.intHex,
		float.floatNaN,
		float.floatExp,
		float.float,
		binary.binary,
		merge.merge,
		omap.omap,
		pairs.pairs,
		set.set,
		timestamp.intTime,
		timestamp.floatTime,
		timestamp.timestamp
	];
})), require_tags = __commonJSMin(((exports) => {
	var map = require_map(), _null = require_null(), seq = require_seq(), string = require_string(), bool = require_bool$1(), float = require_float$1(), int = require_int$1(), schema = require_schema$2(), schema$1 = require_schema$1(), binary = require_binary(), merge = require_merge(), omap = require_omap(), pairs = require_pairs(), schema$2 = require_schema(), set = require_set$1(), timestamp = require_timestamp$4();
	let schemas = new Map([
		["core", schema.schema],
		["failsafe", [
			map.map,
			seq.seq,
			string.string
		]],
		["json", schema$1.schema],
		["yaml11", schema$2.schema],
		["yaml-1.1", schema$2.schema]
	]), tagsByName = {
		binary: binary.binary,
		bool: bool.boolTag,
		float: float.float,
		floatExp: float.floatExp,
		floatNaN: float.floatNaN,
		floatTime: timestamp.floatTime,
		int: int.int,
		intHex: int.intHex,
		intOct: int.intOct,
		intTime: timestamp.intTime,
		map: map.map,
		merge: merge.merge,
		null: _null.nullTag,
		omap: omap.omap,
		pairs: pairs.pairs,
		seq: seq.seq,
		set: set.set,
		timestamp: timestamp.timestamp
	}, coreKnownTags = {
		"tag:yaml.org,2002:binary": binary.binary,
		"tag:yaml.org,2002:merge": merge.merge,
		"tag:yaml.org,2002:omap": omap.omap,
		"tag:yaml.org,2002:pairs": pairs.pairs,
		"tag:yaml.org,2002:set": set.set,
		"tag:yaml.org,2002:timestamp": timestamp.timestamp
	};
	function getTags(customTags, schemaName, addMergeTag) {
		let schemaTags = schemas.get(schemaName);
		if (schemaTags && !customTags) return addMergeTag && !schemaTags.includes(merge.merge) ? schemaTags.concat(merge.merge) : schemaTags.slice();
		let tags = schemaTags;
		if (!tags) {
			if (Array.isArray(customTags)) tags = [];
			else {
				let keys = Array.from(schemas.keys()).filter((key) => key !== "yaml11").map((key) => JSON.stringify(key)).join(", ");
				throw Error(`Unknown schema "${schemaName}"; use one of ${keys} or define customTags array`);
			}
		}
		if (Array.isArray(customTags)) for (let tag of customTags) tags = tags.concat(tag);
		else typeof customTags == "function" && (tags = customTags(tags.slice()));
		return addMergeTag && (tags = tags.concat(merge.merge)), tags.reduce((tags, tag) => {
			let tagObj = typeof tag == "string" ? tagsByName[tag] : tag;
			if (!tagObj) {
				let tagName = JSON.stringify(tag), keys = Object.keys(tagsByName).map((key) => JSON.stringify(key)).join(", ");
				throw Error(`Unknown custom tag ${tagName}; use one of ${keys}`);
			}
			return tags.includes(tagObj) || tags.push(tagObj), tags;
		}, []);
	}
	exports.coreKnownTags = coreKnownTags, exports.getTags = getTags;
})), require_Schema = __commonJSMin(((exports) => {
	var identity = require_identity(), map = require_map(), seq = require_seq(), string = require_string(), tags = require_tags();
	let sortMapEntriesByKey = (a, b) => a.key < b.key ? -1 : +(a.key > b.key);
	exports.Schema = class Schema {
		constructor({ compat, customTags, merge, resolveKnownTags, schema, sortMapEntries, toStringDefaults }) {
			this.compat = Array.isArray(compat) ? tags.getTags(compat, "compat") : compat ? tags.getTags(null, compat) : null, this.name = typeof schema == "string" && schema || "core", this.knownTags = resolveKnownTags ? tags.coreKnownTags : {}, this.tags = tags.getTags(customTags, this.name, merge), this.toStringOptions = toStringDefaults ?? null, Object.defineProperty(this, identity.MAP, { value: map.map }), Object.defineProperty(this, identity.SCALAR, { value: string.string }), Object.defineProperty(this, identity.SEQ, { value: seq.seq }), this.sortMapEntries = typeof sortMapEntries == "function" ? sortMapEntries : sortMapEntries === !0 ? sortMapEntriesByKey : null;
		}
		clone() {
			let copy = Object.create(Schema.prototype, Object.getOwnPropertyDescriptors(this));
			return copy.tags = this.tags.slice(), copy;
		}
	};
})), require_stringifyDocument = __commonJSMin(((exports) => {
	var identity = require_identity(), stringify = require_stringify(), stringifyComment = require_stringifyComment();
	function stringifyDocument(doc, options) {
		let lines = [], hasDirectives = options.directives === !0;
		if (options.directives !== !1 && doc.directives) {
			let dir = doc.directives.toString(doc);
			dir ? (lines.push(dir), hasDirectives = !0) : doc.directives.docStart && (hasDirectives = !0);
		}
		hasDirectives && lines.push("---");
		let ctx = stringify.createStringifyContext(doc, options), { commentString } = ctx.options;
		if (doc.commentBefore) {
			lines.length !== 1 && lines.unshift("");
			let cs = commentString(doc.commentBefore);
			lines.unshift(stringifyComment.indentComment(cs, ""));
		}
		let chompKeep = !1, contentComment = null;
		if (doc.contents) {
			if (identity.isNode(doc.contents)) {
				if (doc.contents.spaceBefore && hasDirectives && lines.push(""), doc.contents.commentBefore) {
					let cs = commentString(doc.contents.commentBefore);
					lines.push(stringifyComment.indentComment(cs, ""));
				}
				ctx.forceBlockIndent = !!doc.comment, contentComment = doc.contents.comment;
			}
			let onChompKeep = contentComment ? void 0 : () => chompKeep = !0, body = stringify.stringify(doc.contents, ctx, () => contentComment = null, onChompKeep);
			contentComment && (body += stringifyComment.lineComment(body, "", commentString(contentComment))), (body[0] === "|" || body[0] === ">") && lines[lines.length - 1] === "---" ? lines[lines.length - 1] = `--- ${body}` : lines.push(body);
		} else lines.push(stringify.stringify(doc.contents, ctx));
		if (doc.directives?.docEnd) {
			if (doc.comment) {
				let cs = commentString(doc.comment);
				cs.includes("\n") ? (lines.push("..."), lines.push(stringifyComment.indentComment(cs, ""))) : lines.push(`... ${cs}`);
			} else lines.push("...");
		} else {
			let dc = doc.comment;
			dc && chompKeep && (dc = dc.replace(/^\n+/, "")), dc && ((!chompKeep || contentComment) && lines[lines.length - 1] !== "" && lines.push(""), lines.push(stringifyComment.indentComment(commentString(dc), "")));
		}
		return lines.join("\n") + "\n";
	}
	exports.stringifyDocument = stringifyDocument;
})), require_Document = __commonJSMin(((exports) => {
	var Alias = require_Alias(), Collection = require_Collection(), identity = require_identity(), Pair = require_Pair(), toJS = require_toJS(), Schema = require_Schema(), stringifyDocument = require_stringifyDocument(), anchors = require_anchors(), applyReviver = require_applyReviver(), createNode = require_createNode(), directives = require_directives(), Document = class Document {
		constructor(value, replacer, options) {
			this.commentBefore = null, this.comment = null, this.errors = [], this.warnings = [], Object.defineProperty(this, identity.NODE_TYPE, { value: identity.DOC });
			let _replacer = null;
			typeof replacer == "function" || Array.isArray(replacer) ? _replacer = replacer : options === void 0 && replacer && (options = replacer, replacer = void 0);
			let opt = Object.assign({
				intAsBigInt: !1,
				keepSourceTokens: !1,
				logLevel: "warn",
				prettyErrors: !0,
				strict: !0,
				stringKeys: !1,
				uniqueKeys: !0,
				version: "1.2"
			}, options);
			this.options = opt;
			let { version } = opt;
			options?._directives ? (this.directives = options._directives.atDocument(), this.directives.yaml.explicit && (version = this.directives.yaml.version)) : this.directives = new directives.Directives({ version }), this.setSchema(version, options), this.contents = value === void 0 ? null : this.createNode(value, _replacer, options);
		}
		clone() {
			let copy = Object.create(Document.prototype, { [identity.NODE_TYPE]: { value: identity.DOC } });
			return copy.commentBefore = this.commentBefore, copy.comment = this.comment, copy.errors = this.errors.slice(), copy.warnings = this.warnings.slice(), copy.options = Object.assign({}, this.options), this.directives && (copy.directives = this.directives.clone()), copy.schema = this.schema.clone(), copy.contents = identity.isNode(this.contents) ? this.contents.clone(copy.schema) : this.contents, this.range && (copy.range = this.range.slice()), copy;
		}
		add(value) {
			assertCollection(this.contents) && this.contents.add(value);
		}
		addIn(path, value) {
			assertCollection(this.contents) && this.contents.addIn(path, value);
		}
		createAlias(node, name) {
			if (!node.anchor) {
				let prev = anchors.anchorNames(this);
				node.anchor = !name || prev.has(name) ? anchors.findNewAnchor(name || "a", prev) : name;
			}
			return new Alias.Alias(node.anchor);
		}
		createNode(value, replacer, options) {
			let _replacer;
			if (typeof replacer == "function") value = replacer.call({ "": value }, "", value), _replacer = replacer;
			else if (Array.isArray(replacer)) {
				let asStr = replacer.filter((v) => typeof v == "number" || v instanceof String || v instanceof Number).map(String);
				asStr.length > 0 && (replacer = replacer.concat(asStr)), _replacer = replacer;
			} else options === void 0 && replacer && (options = replacer, replacer = void 0);
			let { aliasDuplicateObjects, anchorPrefix, flow, keepUndefined, onTagObj, tag } = options ?? {}, { onAnchor, setAnchors, sourceObjects } = anchors.createNodeAnchors(this, anchorPrefix || "a"), ctx = {
				aliasDuplicateObjects: aliasDuplicateObjects ?? !0,
				keepUndefined: keepUndefined ?? !1,
				onAnchor,
				onTagObj,
				replacer: _replacer,
				schema: this.schema,
				sourceObjects
			}, node = createNode.createNode(value, tag, ctx);
			return flow && identity.isCollection(node) && (node.flow = !0), setAnchors(), node;
		}
		createPair(key, value, options = {}) {
			let k = this.createNode(key, null, options), v = this.createNode(value, null, options);
			return new Pair.Pair(k, v);
		}
		delete(key) {
			return assertCollection(this.contents) ? this.contents.delete(key) : !1;
		}
		deleteIn(path) {
			return Collection.isEmptyPath(path) ? this.contents != null && (this.contents = null, !0) : assertCollection(this.contents) ? this.contents.deleteIn(path) : !1;
		}
		get(key, keepScalar) {
			return identity.isCollection(this.contents) ? this.contents.get(key, keepScalar) : void 0;
		}
		getIn(path, keepScalar) {
			return Collection.isEmptyPath(path) ? !keepScalar && identity.isScalar(this.contents) ? this.contents.value : this.contents : identity.isCollection(this.contents) ? this.contents.getIn(path, keepScalar) : void 0;
		}
		has(key) {
			return identity.isCollection(this.contents) ? this.contents.has(key) : !1;
		}
		hasIn(path) {
			return Collection.isEmptyPath(path) ? this.contents !== void 0 : identity.isCollection(this.contents) ? this.contents.hasIn(path) : !1;
		}
		set(key, value) {
			this.contents == null ? this.contents = Collection.collectionFromPath(this.schema, [key], value) : assertCollection(this.contents) && this.contents.set(key, value);
		}
		setIn(path, value) {
			Collection.isEmptyPath(path) ? this.contents = value : this.contents == null ? this.contents = Collection.collectionFromPath(this.schema, Array.from(path), value) : assertCollection(this.contents) && this.contents.setIn(path, value);
		}
		setSchema(version, options = {}) {
			typeof version == "number" && (version = String(version));
			let opt;
			switch (version) {
				case "1.1":
					this.directives ? this.directives.yaml.version = "1.1" : this.directives = new directives.Directives({ version: "1.1" }), opt = {
						resolveKnownTags: !1,
						schema: "yaml-1.1"
					};
					break;
				case "1.2":
				case "next":
					this.directives ? this.directives.yaml.version = version : this.directives = new directives.Directives({ version }), opt = {
						resolveKnownTags: !0,
						schema: "core"
					};
					break;
				case null:
					this.directives && delete this.directives, opt = null;
					break;
				default: {
					let sv = JSON.stringify(version);
					throw Error(`Expected '1.1', '1.2' or null as first argument, but found: ${sv}`);
				}
			}
			if (options.schema instanceof Object) this.schema = options.schema;
			else if (opt) this.schema = new Schema.Schema(Object.assign(opt, options));
			else throw Error("With a null YAML version, the { schema: Schema } option is required");
		}
		toJS({ json, jsonArg, mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
			let ctx = {
				anchors: new Map(),
				doc: this,
				keep: !json,
				mapAsMap: mapAsMap === !0,
				mapKeyWarned: !1,
				maxAliasCount: typeof maxAliasCount == "number" ? maxAliasCount : 100
			}, res = toJS.toJS(this.contents, jsonArg ?? "", ctx);
			if (typeof onAnchor == "function") for (let { count, res } of ctx.anchors.values()) onAnchor(res, count);
			return typeof reviver == "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
		}
		toJSON(jsonArg, onAnchor) {
			return this.toJS({
				json: !0,
				jsonArg,
				mapAsMap: !1,
				onAnchor
			});
		}
		toString(options = {}) {
			if (this.errors.length > 0) throw Error("Document with errors cannot be stringified");
			if ("indent" in options && (!Number.isInteger(options.indent) || Number(options.indent) <= 0)) {
				let s = JSON.stringify(options.indent);
				throw Error(`"indent" option must be a positive integer, not ${s}`);
			}
			return stringifyDocument.stringifyDocument(this, options);
		}
	};
	function assertCollection(contents) {
		if (identity.isCollection(contents)) return !0;
		throw Error("Expected a YAML collection as document contents");
	}
	exports.Document = Document;
})), require_errors = __commonJSMin(((exports) => {
	var YAMLError = class extends Error {
		constructor(name, pos, code, message) {
			super(), this.name = name, this.code = code, this.message = message, this.pos = pos;
		}
	}, YAMLParseError = class extends YAMLError {
		constructor(pos, code, message) {
			super("YAMLParseError", pos, code, message);
		}
	}, YAMLWarning = class extends YAMLError {
		constructor(pos, code, message) {
			super("YAMLWarning", pos, code, message);
		}
	};
	exports.YAMLError = YAMLError, exports.YAMLParseError = YAMLParseError, exports.YAMLWarning = YAMLWarning, exports.prettifyError = (src, lc) => (error) => {
		if (error.pos[0] === -1) return;
		error.linePos = error.pos.map((pos) => lc.linePos(pos));
		let { line, col } = error.linePos[0];
		error.message += ` at line ${line}, column ${col}`;
		let ci = col - 1, lineStr = src.substring(lc.lineStarts[line - 1], lc.lineStarts[line]).replace(/[\n\r]+$/, "");
		if (ci >= 60 && lineStr.length > 80) {
			let trimStart = Math.min(ci - 39, lineStr.length - 79);
			lineStr = "…" + lineStr.substring(trimStart), ci -= trimStart - 1;
		}
		if (lineStr.length > 80 && (lineStr = lineStr.substring(0, 79) + "…"), line > 1 && /^ *$/.test(lineStr.substring(0, ci))) {
			let prev = src.substring(lc.lineStarts[line - 2], lc.lineStarts[line - 1]);
			prev.length > 80 && (prev = prev.substring(0, 79) + "…\n"), lineStr = prev + lineStr;
		}
		if (/[^ ]/.test(lineStr)) {
			let count = 1, end = error.linePos[1];
			end?.line === line && end.col > col && (count = Math.max(1, Math.min(end.col - col, 80 - ci)));
			let pointer = " ".repeat(ci) + "^".repeat(count);
			error.message += `:\n\n${lineStr}\n${pointer}\n`;
		}
	};
})), require_resolve_props = __commonJSMin(((exports) => {
	function resolveProps(tokens, { flow, indicator, next, offset, onError, parentIndent, startOnNewline }) {
		let spaceBefore = !1, atNewline = startOnNewline, hasSpace = startOnNewline, comment = "", commentSep = "", hasNewline = !1, reqSpace = !1, tab = null, anchor = null, tag = null, newlineAfterProp = null, comma = null, found = null, start = null;
		for (let token of tokens) switch (reqSpace &&= (token.type !== "space" && token.type !== "newline" && token.type !== "comma" && onError(token.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space"), !1), tab &&= (atNewline && token.type !== "comment" && token.type !== "newline" && onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation"), null), token.type) {
			case "space":
				!flow && (indicator !== "doc-start" || next?.type !== "flow-collection") && token.source.includes("	") && (tab = token), hasSpace = !0;
				break;
			case "comment": {
				hasSpace || onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
				let cb = token.source.substring(1) || " ";
				comment ? comment += commentSep + cb : comment = cb, commentSep = "", atNewline = !1;
				break;
			}
			case "newline":
				atNewline ? comment ? comment += token.source : (!found || indicator !== "seq-item-ind") && (spaceBefore = !0) : commentSep += token.source, atNewline = !0, hasNewline = !0, (anchor || tag) && (newlineAfterProp = token), hasSpace = !0;
				break;
			case "anchor":
				anchor && onError(token, "MULTIPLE_ANCHORS", "A node can have at most one anchor"), token.source.endsWith(":") && onError(token.offset + token.source.length - 1, "BAD_ALIAS", "Anchor ending in : is ambiguous", !0), anchor = token, start ??= token.offset, atNewline = !1, hasSpace = !1, reqSpace = !0;
				break;
			case "tag":
				tag && onError(token, "MULTIPLE_TAGS", "A node can have at most one tag"), tag = token, start ??= token.offset, atNewline = !1, hasSpace = !1, reqSpace = !0;
				break;
			case indicator:
				(anchor || tag) && onError(token, "BAD_PROP_ORDER", `Anchors and tags must be after the ${token.source} indicator`), found && onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.source} in ${flow ?? "collection"}`), found = token, atNewline = indicator === "seq-item-ind" || indicator === "explicit-key-ind", hasSpace = !1;
				break;
			case "comma": if (flow) {
				comma && onError(token, "UNEXPECTED_TOKEN", `Unexpected , in ${flow}`), comma = token, atNewline = !1, hasSpace = !1;
				break;
			}
			default: onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.type} token`), atNewline = !1, hasSpace = !1;
		}
		let last = tokens[tokens.length - 1], end = last ? last.offset + last.source.length : offset;
		return reqSpace && next && next.type !== "space" && next.type !== "newline" && next.type !== "comma" && (next.type !== "scalar" || next.source !== "") && onError(next.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space"), tab && (atNewline && tab.indent <= parentIndent || next?.type === "block-map" || next?.type === "block-seq") && onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation"), {
			comma,
			found,
			spaceBefore,
			comment,
			hasNewline,
			anchor,
			tag,
			newlineAfterProp,
			end,
			start: start ?? end
		};
	}
	exports.resolveProps = resolveProps;
})), require_util_contains_newline = __commonJSMin(((exports) => {
	function containsNewline(key) {
		if (!key) return null;
		switch (key.type) {
			case "alias":
			case "scalar":
			case "double-quoted-scalar":
			case "single-quoted-scalar":
				if (key.source.includes("\n")) return !0;
				if (key.end) {
					for (let st of key.end) if (st.type === "newline") return !0;
				}
				return !1;
			case "flow-collection":
				for (let it of key.items) {
					for (let st of it.start) if (st.type === "newline") return !0;
					if (it.sep) {
						for (let st of it.sep) if (st.type === "newline") return !0;
					}
					if (containsNewline(it.key) || containsNewline(it.value)) return !0;
				}
				return !1;
			default: return !0;
		}
	}
	exports.containsNewline = containsNewline;
})), require_util_flow_indent_check = __commonJSMin(((exports) => {
	var utilContainsNewline = require_util_contains_newline();
	function flowIndentCheck(indent, fc, onError) {
		if (fc?.type === "flow-collection") {
			let end = fc.end[0];
			end.indent === indent && (end.source === "]" || end.source === "}") && utilContainsNewline.containsNewline(fc) && onError(end, "BAD_INDENT", "Flow end indicator should be more indented than parent", !0);
		}
	}
	exports.flowIndentCheck = flowIndentCheck;
})), require_util_map_includes = __commonJSMin(((exports) => {
	var identity = require_identity();
	function mapIncludes(ctx, items, search) {
		let { uniqueKeys } = ctx.options;
		if (uniqueKeys === !1) return !1;
		let isEqual = typeof uniqueKeys == "function" ? uniqueKeys : (a, b) => a === b || identity.isScalar(a) && identity.isScalar(b) && a.value === b.value;
		return items.some((pair) => isEqual(pair.key, search));
	}
	exports.mapIncludes = mapIncludes;
})), require_resolve_block_map = __commonJSMin(((exports) => {
	var Pair = require_Pair(), YAMLMap = require_YAMLMap(), resolveProps = require_resolve_props(), utilContainsNewline = require_util_contains_newline(), utilFlowIndentCheck = require_util_flow_indent_check(), utilMapIncludes = require_util_map_includes();
	let startColMsg = "All mapping items must start at the same column";
	function resolveBlockMap({ composeNode, composeEmptyNode }, ctx, bm, onError, tag) {
		let map = new ((tag?.nodeClass) ?? YAMLMap.YAMLMap)(ctx.schema);
		ctx.atRoot &&= !1;
		let offset = bm.offset, commentEnd = null;
		for (let collItem of bm.items) {
			let { start, key, sep, value } = collItem, keyProps = resolveProps.resolveProps(start, {
				indicator: "explicit-key-ind",
				next: key ?? sep?.[0],
				offset,
				onError,
				parentIndent: bm.indent,
				startOnNewline: !0
			}), implicitKey = !keyProps.found;
			if (implicitKey) {
				if (key && (key.type === "block-seq" ? onError(offset, "BLOCK_AS_IMPLICIT_KEY", "A block sequence may not be used as an implicit map key") : "indent" in key && key.indent !== bm.indent && onError(offset, "BAD_INDENT", startColMsg)), !keyProps.anchor && !keyProps.tag && !sep) {
					commentEnd = keyProps.end, keyProps.comment && (map.comment ? map.comment += "\n" + keyProps.comment : map.comment = keyProps.comment);
					continue;
				}
				(keyProps.newlineAfterProp || utilContainsNewline.containsNewline(key)) && onError(key ?? start[start.length - 1], "MULTILINE_IMPLICIT_KEY", "Implicit keys need to be on a single line");
			} else keyProps.found?.indent !== bm.indent && onError(offset, "BAD_INDENT", startColMsg);
			ctx.atKey = !0;
			let keyStart = keyProps.end, keyNode = key ? composeNode(ctx, key, keyProps, onError) : composeEmptyNode(ctx, keyStart, start, null, keyProps, onError);
			ctx.schema.compat && utilFlowIndentCheck.flowIndentCheck(bm.indent, key, onError), ctx.atKey = !1, utilMapIncludes.mapIncludes(ctx, map.items, keyNode) && onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
			let valueProps = resolveProps.resolveProps(sep ?? [], {
				indicator: "map-value-ind",
				next: value,
				offset: keyNode.range[2],
				onError,
				parentIndent: bm.indent,
				startOnNewline: !key || key.type === "block-scalar"
			});
			if (offset = valueProps.end, valueProps.found) {
				implicitKey && (value?.type === "block-map" && !valueProps.hasNewline && onError(offset, "BLOCK_AS_IMPLICIT_KEY", "Nested mappings are not allowed in compact mappings"), ctx.options.strict && keyProps.start < valueProps.found.offset - 1024 && onError(keyNode.range, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit block mapping key"));
				let valueNode = value ? composeNode(ctx, value, valueProps, onError) : composeEmptyNode(ctx, offset, sep, null, valueProps, onError);
				ctx.schema.compat && utilFlowIndentCheck.flowIndentCheck(bm.indent, value, onError), offset = valueNode.range[2];
				let pair = new Pair.Pair(keyNode, valueNode);
				ctx.options.keepSourceTokens && (pair.srcToken = collItem), map.items.push(pair);
			} else {
				implicitKey && onError(keyNode.range, "MISSING_CHAR", "Implicit map keys need to be followed by map values"), valueProps.comment && (keyNode.comment ? keyNode.comment += "\n" + valueProps.comment : keyNode.comment = valueProps.comment);
				let pair = new Pair.Pair(keyNode);
				ctx.options.keepSourceTokens && (pair.srcToken = collItem), map.items.push(pair);
			}
		}
		return commentEnd && commentEnd < offset && onError(commentEnd, "IMPOSSIBLE", "Map comment with trailing content"), map.range = [
			bm.offset,
			offset,
			commentEnd ?? offset
		], map;
	}
	exports.resolveBlockMap = resolveBlockMap;
})), require_resolve_block_seq = __commonJSMin(((exports) => {
	var YAMLSeq = require_YAMLSeq(), resolveProps = require_resolve_props(), utilFlowIndentCheck = require_util_flow_indent_check();
	function resolveBlockSeq({ composeNode, composeEmptyNode }, ctx, bs, onError, tag) {
		let seq = new ((tag?.nodeClass) ?? YAMLSeq.YAMLSeq)(ctx.schema);
		ctx.atRoot &&= !1, ctx.atKey &&= !1;
		let offset = bs.offset, commentEnd = null;
		for (let { start, value } of bs.items) {
			let props = resolveProps.resolveProps(start, {
				indicator: "seq-item-ind",
				next: value,
				offset,
				onError,
				parentIndent: bs.indent,
				startOnNewline: !0
			});
			if (!props.found) {
				if (props.anchor || props.tag || value) value?.type === "block-seq" ? onError(props.end, "BAD_INDENT", "All sequence items must start at the same column") : onError(offset, "MISSING_CHAR", "Sequence item without - indicator");
				else {
					commentEnd = props.end, props.comment && (seq.comment = props.comment);
					continue;
				}
			}
			let node = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, start, null, props, onError);
			ctx.schema.compat && utilFlowIndentCheck.flowIndentCheck(bs.indent, value, onError), offset = node.range[2], seq.items.push(node);
		}
		return seq.range = [
			bs.offset,
			offset,
			commentEnd ?? offset
		], seq;
	}
	exports.resolveBlockSeq = resolveBlockSeq;
})), require_resolve_end = __commonJSMin(((exports) => {
	function resolveEnd(end, offset, reqSpace, onError) {
		let comment = "";
		if (end) {
			let hasSpace = !1, sep = "";
			for (let token of end) {
				let { source, type } = token;
				switch (type) {
					case "space":
						hasSpace = !0;
						break;
					case "comment": {
						reqSpace && !hasSpace && onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
						let cb = source.substring(1) || " ";
						comment ? comment += sep + cb : comment = cb, sep = "";
						break;
					}
					case "newline":
						comment && (sep += source), hasSpace = !0;
						break;
					default: onError(token, "UNEXPECTED_TOKEN", `Unexpected ${type} at node end`);
				}
				offset += source.length;
			}
		}
		return {
			comment,
			offset
		};
	}
	exports.resolveEnd = resolveEnd;
})), require_resolve_flow_collection = __commonJSMin(((exports) => {
	var identity = require_identity(), Pair = require_Pair(), YAMLMap = require_YAMLMap(), YAMLSeq = require_YAMLSeq(), resolveEnd = require_resolve_end(), resolveProps = require_resolve_props(), utilContainsNewline = require_util_contains_newline(), utilMapIncludes = require_util_map_includes();
	let blockMsg = "Block collections are not allowed within flow collections", isBlock = (token) => token && (token.type === "block-map" || token.type === "block-seq");
	function resolveFlowCollection({ composeNode, composeEmptyNode }, ctx, fc, onError, tag) {
		let isMap = fc.start.source === "{", fcName = isMap ? "flow map" : "flow sequence", coll = new ((tag?.nodeClass) ?? (isMap ? YAMLMap.YAMLMap : YAMLSeq.YAMLSeq))(ctx.schema);
		coll.flow = !0;
		let atRoot = ctx.atRoot;
		atRoot && (ctx.atRoot = !1), ctx.atKey &&= !1;
		let offset = fc.offset + fc.start.source.length;
		for (let i = 0; i < fc.items.length; ++i) {
			let collItem = fc.items[i], { start, key, sep, value } = collItem, props = resolveProps.resolveProps(start, {
				flow: fcName,
				indicator: "explicit-key-ind",
				next: key ?? sep?.[0],
				offset,
				onError,
				parentIndent: fc.indent,
				startOnNewline: !1
			});
			if (!props.found) {
				if (!props.anchor && !props.tag && !sep && !value) {
					i === 0 && props.comma ? onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`) : i < fc.items.length - 1 && onError(props.start, "UNEXPECTED_TOKEN", `Unexpected empty item in ${fcName}`), props.comment && (coll.comment ? coll.comment += "\n" + props.comment : coll.comment = props.comment), offset = props.end;
					continue;
				}
				!isMap && ctx.options.strict && utilContainsNewline.containsNewline(key) && onError(key, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
			}
			if (i === 0) props.comma && onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
			else if (props.comma || onError(props.start, "MISSING_CHAR", `Missing , between ${fcName} items`), props.comment) {
				let prevItemComment = "";
				loop: for (let st of start) switch (st.type) {
					case "comma":
					case "space": break;
					case "comment":
						prevItemComment = st.source.substring(1);
						break loop;
					default: break loop;
				}
				if (prevItemComment) {
					let prev = coll.items[coll.items.length - 1];
					identity.isPair(prev) && (prev = prev.value ?? prev.key), prev.comment ? prev.comment += "\n" + prevItemComment : prev.comment = prevItemComment, props.comment = props.comment.substring(prevItemComment.length + 1);
				}
			}
			if (!isMap && !sep && !props.found) {
				let valueNode = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, sep, null, props, onError);
				coll.items.push(valueNode), offset = valueNode.range[2], isBlock(value) && onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
			} else {
				ctx.atKey = !0;
				let keyStart = props.end, keyNode = key ? composeNode(ctx, key, props, onError) : composeEmptyNode(ctx, keyStart, start, null, props, onError);
				isBlock(key) && onError(keyNode.range, "BLOCK_IN_FLOW", blockMsg), ctx.atKey = !1;
				let valueProps = resolveProps.resolveProps(sep ?? [], {
					flow: fcName,
					indicator: "map-value-ind",
					next: value,
					offset: keyNode.range[2],
					onError,
					parentIndent: fc.indent,
					startOnNewline: !1
				});
				if (valueProps.found) {
					if (!isMap && !props.found && ctx.options.strict) {
						if (sep) for (let st of sep) {
							if (st === valueProps.found) break;
							if (st.type === "newline") {
								onError(st, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
								break;
							}
						}
						props.start < valueProps.found.offset - 1024 && onError(valueProps.found, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit flow sequence key");
					}
				} else value && ("source" in value && value.source?.[0] === ":" ? onError(value, "MISSING_CHAR", `Missing space after : in ${fcName}`) : onError(valueProps.start, "MISSING_CHAR", `Missing , or : between ${fcName} items`));
				let valueNode = value ? composeNode(ctx, value, valueProps, onError) : valueProps.found ? composeEmptyNode(ctx, valueProps.end, sep, null, valueProps, onError) : null;
				valueNode ? isBlock(value) && onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg) : valueProps.comment && (keyNode.comment ? keyNode.comment += "\n" + valueProps.comment : keyNode.comment = valueProps.comment);
				let pair = new Pair.Pair(keyNode, valueNode);
				if (ctx.options.keepSourceTokens && (pair.srcToken = collItem), isMap) {
					let map = coll;
					utilMapIncludes.mapIncludes(ctx, map.items, keyNode) && onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique"), map.items.push(pair);
				} else {
					let map = new YAMLMap.YAMLMap(ctx.schema);
					map.flow = !0, map.items.push(pair);
					let endRange = (valueNode ?? keyNode).range;
					map.range = [
						keyNode.range[0],
						endRange[1],
						endRange[2]
					], coll.items.push(map);
				}
				offset = valueNode ? valueNode.range[2] : valueProps.end;
			}
		}
		let expectedEnd = isMap ? "}" : "]", [ce, ...ee] = fc.end, cePos = offset;
		if (ce?.source === expectedEnd) cePos = ce.offset + ce.source.length;
		else {
			let name = fcName[0].toUpperCase() + fcName.substring(1), msg = atRoot ? `${name} must end with a ${expectedEnd}` : `${name} in block collection must be sufficiently indented and end with a ${expectedEnd}`;
			onError(offset, atRoot ? "MISSING_CHAR" : "BAD_INDENT", msg), ce && ce.source.length !== 1 && ee.unshift(ce);
		}
		if (ee.length > 0) {
			let end = resolveEnd.resolveEnd(ee, cePos, ctx.options.strict, onError);
			end.comment && (coll.comment ? coll.comment += "\n" + end.comment : coll.comment = end.comment), coll.range = [
				fc.offset,
				cePos,
				end.offset
			];
		} else coll.range = [
			fc.offset,
			cePos,
			cePos
		];
		return coll;
	}
	exports.resolveFlowCollection = resolveFlowCollection;
})), require_compose_collection = __commonJSMin(((exports) => {
	var identity = require_identity(), Scalar = require_Scalar(), YAMLMap = require_YAMLMap(), YAMLSeq = require_YAMLSeq(), resolveBlockMap = require_resolve_block_map(), resolveBlockSeq = require_resolve_block_seq(), resolveFlowCollection = require_resolve_flow_collection();
	function resolveCollection(CN, ctx, token, onError, tagName, tag) {
		let coll = token.type === "block-map" ? resolveBlockMap.resolveBlockMap(CN, ctx, token, onError, tag) : token.type === "block-seq" ? resolveBlockSeq.resolveBlockSeq(CN, ctx, token, onError, tag) : resolveFlowCollection.resolveFlowCollection(CN, ctx, token, onError, tag), Coll = coll.constructor;
		return tagName === "!" || tagName === Coll.tagName ? (coll.tag = Coll.tagName, coll) : (tagName && (coll.tag = tagName), coll);
	}
	function composeCollection(CN, ctx, token, props, onError) {
		let tagToken = props.tag, tagName = tagToken ? ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg)) : null;
		if (token.type === "block-seq") {
			let { anchor, newlineAfterProp: nl } = props, lastProp = anchor && tagToken ? anchor.offset > tagToken.offset ? anchor : tagToken : anchor ?? tagToken;
			lastProp && (!nl || nl.offset < lastProp.offset) && onError(lastProp, "MISSING_CHAR", "Missing newline after block sequence props");
		}
		let expType = token.type === "block-map" ? "map" : token.type === "block-seq" ? "seq" : token.start.source === "{" ? "map" : "seq";
		if (!tagToken || !tagName || tagName === "!" || tagName === YAMLMap.YAMLMap.tagName && expType === "map" || tagName === YAMLSeq.YAMLSeq.tagName && expType === "seq") return resolveCollection(CN, ctx, token, onError, tagName);
		let tag = ctx.schema.tags.find((t) => t.tag === tagName && t.collection === expType);
		if (!tag) {
			let kt = ctx.schema.knownTags[tagName];
			if (kt?.collection === expType) ctx.schema.tags.push(Object.assign({}, kt, { default: !1 })), tag = kt;
			else return kt ? onError(tagToken, "BAD_COLLECTION_TYPE", `${kt.tag} used for ${expType} collection, but expects ${kt.collection ?? "scalar"}`, !0) : onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, !0), resolveCollection(CN, ctx, token, onError, tagName);
		}
		let coll = resolveCollection(CN, ctx, token, onError, tagName, tag), res = tag.resolve?.(coll, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg), ctx.options) ?? coll, node = identity.isNode(res) ? res : new Scalar.Scalar(res);
		return node.range = coll.range, node.tag = tagName, tag?.format && (node.format = tag.format), node;
	}
	exports.composeCollection = composeCollection;
})), require_resolve_block_scalar = __commonJSMin(((exports) => {
	var Scalar = require_Scalar();
	function resolveBlockScalar(ctx, scalar, onError) {
		let start = scalar.offset, header = parseBlockScalarHeader(scalar, ctx.options.strict, onError);
		if (!header) return {
			value: "",
			type: null,
			comment: "",
			range: [
				start,
				start,
				start
			]
		};
		let type = header.mode === ">" ? Scalar.Scalar.BLOCK_FOLDED : Scalar.Scalar.BLOCK_LITERAL, lines = scalar.source ? splitLines(scalar.source) : [], chompStart = lines.length;
		for (let i = lines.length - 1; i >= 0; --i) {
			let content = lines[i][1];
			if (content === "" || content === "\r") chompStart = i;
			else break;
		}
		if (chompStart === 0) {
			let value = header.chomp === "+" && lines.length > 0 ? "\n".repeat(Math.max(1, lines.length - 1)) : "", end = start + header.length;
			return scalar.source && (end += scalar.source.length), {
				value,
				type,
				comment: header.comment,
				range: [
					start,
					end,
					end
				]
			};
		}
		let trimIndent = scalar.indent + header.indent, offset = scalar.offset + header.length, contentStart = 0;
		for (let i = 0; i < chompStart; ++i) {
			let [indent, content] = lines[i];
			if (content === "" || content === "\r") header.indent === 0 && indent.length > trimIndent && (trimIndent = indent.length);
			else {
				indent.length < trimIndent && onError(offset + indent.length, "MISSING_CHAR", "Block scalars with more-indented leading empty lines must use an explicit indentation indicator"), header.indent === 0 && (trimIndent = indent.length), contentStart = i, trimIndent === 0 && !ctx.atRoot && onError(offset, "BAD_INDENT", "Block scalar values in collections must be indented");
				break;
			}
			offset += indent.length + content.length + 1;
		}
		for (let i = lines.length - 1; i >= chompStart; --i) lines[i][0].length > trimIndent && (chompStart = i + 1);
		let value = "", sep = "", prevMoreIndented = !1;
		for (let i = 0; i < contentStart; ++i) value += lines[i][0].slice(trimIndent) + "\n";
		for (let i = contentStart; i < chompStart; ++i) {
			let [indent, content] = lines[i];
			offset += indent.length + content.length + 1;
			let crlf = content[content.length - 1] === "\r";
			if (crlf && (content = content.slice(0, -1)), content && indent.length < trimIndent) {
				let message = `Block scalar lines must not be less indented than their ${header.indent ? "explicit indentation indicator" : "first line"}`;
				onError(offset - content.length - (crlf ? 2 : 1), "BAD_INDENT", message), indent = "";
			}
			type === Scalar.Scalar.BLOCK_LITERAL ? (value += sep + indent.slice(trimIndent) + content, sep = "\n") : indent.length > trimIndent || content[0] === "	" ? (sep === " " ? sep = "\n" : !prevMoreIndented && sep === "\n" && (sep = "\n\n"), value += sep + indent.slice(trimIndent) + content, sep = "\n", prevMoreIndented = !0) : content === "" ? sep === "\n" ? value += "\n" : sep = "\n" : (value += sep + content, sep = " ", prevMoreIndented = !1);
		}
		switch (header.chomp) {
			case "-": break;
			case "+":
				for (let i = chompStart; i < lines.length; ++i) value += "\n" + lines[i][0].slice(trimIndent);
				value[value.length - 1] !== "\n" && (value += "\n");
				break;
			default: value += "\n";
		}
		let end = start + header.length + scalar.source.length;
		return {
			value,
			type,
			comment: header.comment,
			range: [
				start,
				end,
				end
			]
		};
	}
	function parseBlockScalarHeader({ offset, props }, strict, onError) {
		if (props[0].type !== "block-scalar-header") return onError(props[0], "IMPOSSIBLE", "Block scalar header not found"), null;
		let { source } = props[0], mode = source[0], indent = 0, chomp = "", error = -1;
		for (let i = 1; i < source.length; ++i) {
			let ch = source[i];
			if (!chomp && (ch === "-" || ch === "+")) chomp = ch;
			else {
				let n = Number(ch);
				!indent && n ? indent = n : error === -1 && (error = offset + i);
			}
		}
		error !== -1 && onError(error, "UNEXPECTED_TOKEN", `Block scalar header includes extra characters: ${source}`);
		let hasSpace = !1, comment = "", length = source.length;
		for (let i = 1; i < props.length; ++i) {
			let token = props[i];
			switch (token.type) {
				case "space": hasSpace = !0;
				case "newline":
					length += token.source.length;
					break;
				case "comment":
					strict && !hasSpace && onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters"), length += token.source.length, comment = token.source.substring(1);
					break;
				case "error":
					onError(token, "UNEXPECTED_TOKEN", token.message), length += token.source.length;
					break;
				default: {
					onError(token, "UNEXPECTED_TOKEN", `Unexpected token in block scalar header: ${token.type}`);
					let ts = token.source;
					ts && typeof ts == "string" && (length += ts.length);
				}
			}
		}
		return {
			mode,
			indent,
			chomp,
			comment,
			length
		};
	}
	function splitLines(source) {
		let split = source.split(/\n( *)/), first = split[0], m = first.match(/^( *)/), lines = [m?.[1] ? [m[1], first.slice(m[1].length)] : ["", first]];
		for (let i = 1; i < split.length; i += 2) lines.push([split[i], split[i + 1]]);
		return lines;
	}
	exports.resolveBlockScalar = resolveBlockScalar;
})), require_resolve_flow_scalar = __commonJSMin(((exports) => {
	var Scalar = require_Scalar(), resolveEnd = require_resolve_end();
	function resolveFlowScalar(scalar, strict, onError) {
		let { offset, type, source, end } = scalar, _type, value, _onError = (rel, code, msg) => onError(offset + rel, code, msg);
		switch (type) {
			case "scalar":
				_type = Scalar.Scalar.PLAIN, value = plainValue(source, _onError);
				break;
			case "single-quoted-scalar":
				_type = Scalar.Scalar.QUOTE_SINGLE, value = singleQuotedValue(source, _onError);
				break;
			case "double-quoted-scalar":
				_type = Scalar.Scalar.QUOTE_DOUBLE, value = doubleQuotedValue(source, _onError);
				break;
			default: return onError(scalar, "UNEXPECTED_TOKEN", `Expected a flow scalar value, but found: ${type}`), {
				value: "",
				type: null,
				comment: "",
				range: [
					offset,
					offset + source.length,
					offset + source.length
				]
			};
		}
		let valueEnd = offset + source.length, re = resolveEnd.resolveEnd(end, valueEnd, strict, onError);
		return {
			value,
			type: _type,
			comment: re.comment,
			range: [
				offset,
				valueEnd,
				re.offset
			]
		};
	}
	function plainValue(source, onError) {
		let badChar = "";
		switch (source[0]) {
			case "	":
				badChar = "a tab character";
				break;
			case ",":
				badChar = "flow indicator character ,";
				break;
			case "%":
				badChar = "directive indicator character %";
				break;
			case "|":
			case ">":
				badChar = `block scalar indicator ${source[0]}`;
				break;
			case "@":
			case "`": badChar = `reserved character ${source[0]}`;
		}
		return badChar && onError(0, "BAD_SCALAR_START", `Plain value cannot start with ${badChar}`), unfoldLines(source);
	}
	function singleQuotedValue(source, onError) {
		return (source[source.length - 1] !== "'" || source.length === 1) && onError(source.length, "MISSING_CHAR", "Missing closing 'quote"), unfoldLines(source.slice(1, -1)).replace(/''/g, "'");
	}
	function unfoldLines(source) {
		let line = /(.*?)\r?\n/sy, match = line.exec(source);
		if (!match) return source;
		let trimEnd, trimBoth;
		try {
			trimEnd = RegExp("(?<![ 	])[ 	]+$"), trimBoth = RegExp("^[ 	]+|(?<![ 	])[ 	]+$", "g");
		} catch {
			trimEnd = /[ \t]+$/, trimBoth = /^[ \t]+|[ \t]+$/g;
		}
		let res = match[1].replace(trimEnd, ""), sep = " ", pos = line.lastIndex;
		for (; match = line.exec(source);) {
			let lm = match[1].replace(trimBoth, "");
			lm === "" ? sep === "\n" ? res += sep : sep = "\n" : (res += sep + lm, sep = " "), pos = line.lastIndex;
		}
		let last = /[ \t]*(.*)/sy;
		return last.lastIndex = pos, match = last.exec(source), res + sep + (match?.[1] ?? "");
	}
	function doubleQuotedValue(source, onError) {
		let res = "";
		for (let i = 1; i < source.length - 1; ++i) {
			let ch = source[i];
			if (ch !== "\r" || source[i + 1] !== "\n") {
				if (ch === "\n") {
					let { fold, offset } = foldNewline(source, i);
					res += fold, i = offset;
				} else if (ch === "\\") {
					let next = source[++i], cc = escapeCodes[next];
					if (cc) res += cc;
					else if (next === "\n") for (next = source[i + 1]; next === " " || next === "	";) next = source[++i + 1];
					else if (next === "\r" && source[i + 1] === "\n") for (next = source[++i + 1]; next === " " || next === "	";) next = source[++i + 1];
					else if (next === "x" || next === "u" || next === "U") {
						let length = next === "x" ? 2 : next === "u" ? 4 : 8;
						res += parseCharCode(source, i + 1, length, onError), i += length;
					} else {
						let raw = source.substr(i - 1, 2);
						onError(i - 1, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`), res += raw;
					}
				} else if (ch === " " || ch === "	") {
					let wsStart = i, next = source[i + 1];
					for (; next === " " || next === "	";) next = source[++i + 1];
					next !== "\n" && (next !== "\r" || source[i + 2] !== "\n") && (res += i > wsStart ? source.slice(wsStart, i + 1) : ch);
				} else res += ch;
			}
		}
		return (source[source.length - 1] !== "\"" || source.length === 1) && onError(source.length, "MISSING_CHAR", "Missing closing \"quote"), res;
	}
	function foldNewline(source, offset) {
		let fold = "", ch = source[offset + 1];
		for (; (ch === " " || ch === "	" || ch === "\n" || ch === "\r") && (ch !== "\r" || source[offset + 2] === "\n");) ch === "\n" && (fold += "\n"), offset += 1, ch = source[offset + 1];
		return fold ||= " ", {
			fold,
			offset
		};
	}
	let escapeCodes = {
		0: "\0",
		a: "\x07",
		b: "\b",
		e: "\x1B",
		f: "\f",
		n: "\n",
		r: "\r",
		t: "	",
		v: "\v",
		N: "",
		_: "\xA0",
		L: "\u2028",
		P: "\u2029",
		" ": " ",
		"\"": "\"",
		"/": "/",
		"\\": "\\",
		"	": "	"
	};
	function parseCharCode(source, offset, length, onError) {
		let cc = source.substr(offset, length), code = cc.length === length && /^[0-9a-fA-F]+$/.test(cc) ? parseInt(cc, 16) : NaN;
		try {
			return String.fromCodePoint(code);
		} catch {
			let raw = source.substr(offset - 2, length + 2);
			return onError(offset - 2, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`), raw;
		}
	}
	exports.resolveFlowScalar = resolveFlowScalar;
})), require_compose_scalar = __commonJSMin(((exports) => {
	var identity = require_identity(), Scalar = require_Scalar(), resolveBlockScalar = require_resolve_block_scalar(), resolveFlowScalar = require_resolve_flow_scalar();
	function composeScalar(ctx, token, tagToken, onError) {
		let { value, type, comment, range } = token.type === "block-scalar" ? resolveBlockScalar.resolveBlockScalar(ctx, token, onError) : resolveFlowScalar.resolveFlowScalar(token, ctx.options.strict, onError), tagName = tagToken ? ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg)) : null, tag;
		tag = ctx.options.stringKeys && ctx.atKey ? ctx.schema[identity.SCALAR] : tagName ? findScalarTagByName(ctx.schema, value, tagName, tagToken, onError) : token.type === "scalar" ? findScalarTagByTest(ctx, value, token, onError) : ctx.schema[identity.SCALAR];
		let scalar;
		try {
			let res = tag.resolve(value, (msg) => onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg), ctx.options);
			scalar = identity.isScalar(res) ? res : new Scalar.Scalar(res);
		} catch (error) {
			let msg = error instanceof Error ? error.message : String(error);
			onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg), scalar = new Scalar.Scalar(value);
		}
		return scalar.range = range, scalar.source = value, type && (scalar.type = type), tagName && (scalar.tag = tagName), tag.format && (scalar.format = tag.format), comment && (scalar.comment = comment), scalar;
	}
	function findScalarTagByName(schema, value, tagName, tagToken, onError) {
		if (tagName === "!") return schema[identity.SCALAR];
		let matchWithTest = [];
		for (let tag of schema.tags) if (!tag.collection && tag.tag === tagName) {
			if (tag.default && tag.test) matchWithTest.push(tag);
			else return tag;
		}
		for (let tag of matchWithTest) if (tag.test?.test(value)) return tag;
		let kt = schema.knownTags[tagName];
		return kt && !kt.collection ? (schema.tags.push(Object.assign({}, kt, {
			default: !1,
			test: void 0
		})), kt) : (onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, tagName !== "tag:yaml.org,2002:str"), schema[identity.SCALAR]);
	}
	function findScalarTagByTest({ atKey, directives, schema }, value, token, onError) {
		let tag = schema.tags.find((tag) => (tag.default === !0 || atKey && tag.default === "key") && tag.test?.test(value)) || schema[identity.SCALAR];
		if (schema.compat) {
			let compat = schema.compat.find((tag) => tag.default && tag.test?.test(value)) ?? schema[identity.SCALAR];
			tag.tag !== compat.tag && onError(token, "TAG_RESOLVE_FAILED", `Value may be parsed as either ${directives.tagString(tag.tag)} or ${directives.tagString(compat.tag)}`, !0);
		}
		return tag;
	}
	exports.composeScalar = composeScalar;
})), require_util_empty_scalar_position = __commonJSMin(((exports) => {
	function emptyScalarPosition(offset, before, pos) {
		if (before) {
			pos ??= before.length;
			for (let i = pos - 1; i >= 0; --i) {
				let st = before[i];
				switch (st.type) {
					case "space":
					case "comment":
					case "newline":
						offset -= st.source.length;
						continue;
				}
				for (st = before[++i]; st?.type === "space";) offset += st.source.length, st = before[++i];
				break;
			}
		}
		return offset;
	}
	exports.emptyScalarPosition = emptyScalarPosition;
})), require_compose_node = __commonJSMin(((exports) => {
	var Alias = require_Alias(), identity = require_identity(), composeCollection = require_compose_collection(), composeScalar = require_compose_scalar(), resolveEnd = require_resolve_end(), utilEmptyScalarPosition = require_util_empty_scalar_position();
	let CN = {
		composeNode,
		composeEmptyNode
	};
	function composeNode(ctx, token, props, onError) {
		let atKey = ctx.atKey, { spaceBefore, comment, anchor, tag } = props, node, isSrcToken = !0;
		switch (token.type) {
			case "alias":
				node = composeAlias(ctx, token, onError), (anchor || tag) && onError(token, "ALIAS_PROPS", "An alias node must not specify any properties");
				break;
			case "scalar":
			case "single-quoted-scalar":
			case "double-quoted-scalar":
			case "block-scalar":
				node = composeScalar.composeScalar(ctx, token, tag, onError), anchor && (node.anchor = anchor.source.substring(1));
				break;
			case "block-map":
			case "block-seq":
			case "flow-collection":
				try {
					node = composeCollection.composeCollection(CN, ctx, token, props, onError), anchor && (node.anchor = anchor.source.substring(1));
				} catch (error) {
					onError(token, "RESOURCE_EXHAUSTION", error instanceof Error ? error.message : String(error));
				}
				break;
			default: onError(token, "UNEXPECTED_TOKEN", token.type === "error" ? token.message : `Unsupported token (type: ${token.type})`), isSrcToken = !1;
		}
		return node ??= composeEmptyNode(ctx, token.offset, void 0, null, props, onError), anchor && node.anchor === "" && onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string"), atKey && ctx.options.stringKeys && (!identity.isScalar(node) || typeof node.value != "string" || node.tag && node.tag !== "tag:yaml.org,2002:str") && onError(tag ?? token, "NON_STRING_KEY", "With stringKeys, all keys must be strings"), spaceBefore && (node.spaceBefore = !0), comment && (token.type === "scalar" && token.source === "" ? node.comment = comment : node.commentBefore = comment), ctx.options.keepSourceTokens && isSrcToken && (node.srcToken = token), node;
	}
	function composeEmptyNode(ctx, offset, before, pos, { spaceBefore, comment, anchor, tag, end }, onError) {
		let token = {
			type: "scalar",
			offset: utilEmptyScalarPosition.emptyScalarPosition(offset, before, pos),
			indent: -1,
			source: ""
		}, node = composeScalar.composeScalar(ctx, token, tag, onError);
		return anchor && (node.anchor = anchor.source.substring(1), node.anchor === "" && onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string")), spaceBefore && (node.spaceBefore = !0), comment && (node.comment = comment, node.range[2] = end), node;
	}
	function composeAlias({ options }, { offset, source, end }, onError) {
		let alias = new Alias.Alias(source.substring(1));
		alias.source === "" && onError(offset, "BAD_ALIAS", "Alias cannot be an empty string"), alias.source.endsWith(":") && onError(offset + source.length - 1, "BAD_ALIAS", "Alias ending in : is ambiguous", !0);
		let valueEnd = offset + source.length, re = resolveEnd.resolveEnd(end, valueEnd, options.strict, onError);
		return alias.range = [
			offset,
			valueEnd,
			re.offset
		], re.comment && (alias.comment = re.comment), alias;
	}
	exports.composeEmptyNode = composeEmptyNode, exports.composeNode = composeNode;
})), require_compose_doc = __commonJSMin(((exports) => {
	var Document = require_Document(), composeNode = require_compose_node(), resolveEnd = require_resolve_end(), resolveProps = require_resolve_props();
	function composeDoc(options, directives, { offset, start, value, end }, onError) {
		let opts = Object.assign({ _directives: directives }, options), doc = new Document.Document(void 0, opts), ctx = {
			atKey: !1,
			atRoot: !0,
			directives: doc.directives,
			options: doc.options,
			schema: doc.schema
		}, props = resolveProps.resolveProps(start, {
			indicator: "doc-start",
			next: value ?? end?.[0],
			offset,
			onError,
			parentIndent: 0,
			startOnNewline: !0
		});
		props.found && (doc.directives.docStart = !0, value && (value.type === "block-map" || value.type === "block-seq") && !props.hasNewline && onError(props.end, "MISSING_CHAR", "Block collection cannot start on same line with directives-end marker")), doc.contents = value ? composeNode.composeNode(ctx, value, props, onError) : composeNode.composeEmptyNode(ctx, props.end, start, null, props, onError);
		let contentEnd = doc.contents.range[2], re = resolveEnd.resolveEnd(end, contentEnd, !1, onError);
		return re.comment && (doc.comment = re.comment), doc.range = [
			offset,
			contentEnd,
			re.offset
		], doc;
	}
	exports.composeDoc = composeDoc;
})), require_composer = __commonJSMin(((exports) => {
	var node_process$1 = require("process"), directives = require_directives(), Document = require_Document(), errors = require_errors(), identity = require_identity(), composeDoc = require_compose_doc(), resolveEnd = require_resolve_end();
	function getErrorPos(src) {
		if (typeof src == "number") return [src, src + 1];
		if (Array.isArray(src)) return src.length === 2 ? src : [src[0], src[1]];
		let { offset, source } = src;
		return [offset, offset + (typeof source == "string" ? source.length : 1)];
	}
	function parsePrelude(prelude) {
		let comment = "", atComment = !1, afterEmptyLine = !1;
		for (let i = 0; i < prelude.length; ++i) {
			let source = prelude[i];
			switch (source[0]) {
				case "#":
					comment += (comment === "" ? "" : afterEmptyLine ? "\n\n" : "\n") + (source.substring(1) || " "), atComment = !0, afterEmptyLine = !1;
					break;
				case "%":
					prelude[i + 1]?.[0] !== "#" && (i += 1), atComment = !1;
					break;
				default: atComment || (afterEmptyLine = !0), atComment = !1;
			}
		}
		return {
			comment,
			afterEmptyLine
		};
	}
	exports.Composer = class {
		constructor(options = {}) {
			this.doc = null, this.atDirectives = !1, this.prelude = [], this.errors = [], this.warnings = [], this.onError = (source, code, message, warning) => {
				let pos = getErrorPos(source);
				warning ? this.warnings.push(new errors.YAMLWarning(pos, code, message)) : this.errors.push(new errors.YAMLParseError(pos, code, message));
			}, this.directives = new directives.Directives({ version: options.version || "1.2" }), this.options = options;
		}
		decorate(doc, afterDoc) {
			let { comment, afterEmptyLine } = parsePrelude(this.prelude);
			if (comment) {
				let dc = doc.contents;
				if (afterDoc) doc.comment = doc.comment ? `${doc.comment}\n${comment}` : comment;
				else if (afterEmptyLine || doc.directives.docStart || !dc) doc.commentBefore = comment;
				else if (identity.isCollection(dc) && !dc.flow && dc.items.length > 0) {
					let it = dc.items[0];
					identity.isPair(it) && (it = it.key);
					let cb = it.commentBefore;
					it.commentBefore = cb ? `${comment}\n${cb}` : comment;
				} else {
					let cb = dc.commentBefore;
					dc.commentBefore = cb ? `${comment}\n${cb}` : comment;
				}
			}
			if (afterDoc) {
				for (let i = 0; i < this.errors.length; ++i) doc.errors.push(this.errors[i]);
				for (let i = 0; i < this.warnings.length; ++i) doc.warnings.push(this.warnings[i]);
			} else doc.errors = this.errors, doc.warnings = this.warnings;
			this.prelude = [], this.errors = [], this.warnings = [];
		}
		streamInfo() {
			return {
				comment: parsePrelude(this.prelude).comment,
				directives: this.directives,
				errors: this.errors,
				warnings: this.warnings
			};
		}
		*compose(tokens, forceDoc = !1, endOffset = -1) {
			for (let token of tokens) yield* this.next(token);
			yield* this.end(forceDoc, endOffset);
		}
		*next(token) {
			switch (node_process$1.env.LOG_STREAM && console.dir(token, { depth: null }), token.type) {
				case "directive":
					this.directives.add(token.source, (offset, message, warning) => {
						let pos = getErrorPos(token);
						pos[0] += offset, this.onError(pos, "BAD_DIRECTIVE", message, warning);
					}), this.prelude.push(token.source), this.atDirectives = !0;
					break;
				case "document": {
					let doc = composeDoc.composeDoc(this.options, this.directives, token, this.onError);
					this.atDirectives && !doc.directives.docStart && this.onError(token, "MISSING_CHAR", "Missing directives-end/doc-start indicator line"), this.decorate(doc, !1), this.doc && (yield this.doc), this.doc = doc, this.atDirectives = !1;
					break;
				}
				case "byte-order-mark":
				case "space": break;
				case "comment":
				case "newline":
					this.prelude.push(token.source);
					break;
				case "error": {
					let msg = token.source ? `${token.message}: ${JSON.stringify(token.source)}` : token.message, error = new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg);
					this.atDirectives || !this.doc ? this.errors.push(error) : this.doc.errors.push(error);
					break;
				}
				case "doc-end": {
					if (!this.doc) {
						this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", "Unexpected doc-end without preceding document"));
						break;
					}
					this.doc.directives.docEnd = !0;
					let end = resolveEnd.resolveEnd(token.end, token.offset + token.source.length, this.doc.options.strict, this.onError);
					if (this.decorate(this.doc, !0), end.comment) {
						let dc = this.doc.comment;
						this.doc.comment = dc ? `${dc}\n${end.comment}` : end.comment;
					}
					this.doc.range[2] = end.offset;
					break;
				}
				default: this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", `Unsupported token ${token.type}`));
			}
		}
		*end(forceDoc = !1, endOffset = -1) {
			if (this.doc) this.decorate(this.doc, !0), yield this.doc, this.doc = null;
			else if (forceDoc) {
				let opts = Object.assign({ _directives: this.directives }, this.options), doc = new Document.Document(void 0, opts);
				this.atDirectives && this.onError(endOffset, "MISSING_CHAR", "Missing directives-end indicator line"), doc.range = [
					0,
					endOffset,
					endOffset
				], this.decorate(doc, !1), yield doc;
			}
		}
	};
})), require_cst_scalar = __commonJSMin(((exports) => {
	var resolveBlockScalar = require_resolve_block_scalar(), resolveFlowScalar = require_resolve_flow_scalar(), errors = require_errors(), stringifyString = require_stringifyString();
	function resolveAsScalar(token, strict = !0, onError) {
		if (token) {
			let _onError = (pos, code, message) => {
				let offset = typeof pos == "number" ? pos : Array.isArray(pos) ? pos[0] : pos.offset;
				if (onError) onError(offset, code, message);
				else throw new errors.YAMLParseError([offset, offset + 1], code, message);
			};
			switch (token.type) {
				case "scalar":
				case "single-quoted-scalar":
				case "double-quoted-scalar": return resolveFlowScalar.resolveFlowScalar(token, strict, _onError);
				case "block-scalar": return resolveBlockScalar.resolveBlockScalar({ options: { strict } }, token, _onError);
			}
		}
		return null;
	}
	function createScalarToken(value, context) {
		let { implicitKey = !1, indent, inFlow = !1, offset = -1, type = "PLAIN" } = context, source = stringifyString.stringifyString({
			type,
			value
		}, {
			implicitKey,
			indent: indent > 0 ? " ".repeat(indent) : "",
			inFlow,
			options: {
				blockQuote: !0,
				lineWidth: -1
			}
		}), end = context.end ?? [{
			type: "newline",
			offset: -1,
			indent,
			source: "\n"
		}];
		switch (source[0]) {
			case "|":
			case ">": {
				let he = source.indexOf("\n"), head = source.substring(0, he), body = source.substring(he + 1) + "\n", props = [{
					type: "block-scalar-header",
					offset,
					indent,
					source: head
				}];
				return addEndtoBlockProps(props, end) || props.push({
					type: "newline",
					offset: -1,
					indent,
					source: "\n"
				}), {
					type: "block-scalar",
					offset,
					indent,
					props,
					source: body
				};
			}
			case "\"": return {
				type: "double-quoted-scalar",
				offset,
				indent,
				source,
				end
			};
			case "'": return {
				type: "single-quoted-scalar",
				offset,
				indent,
				source,
				end
			};
			default: return {
				type: "scalar",
				offset,
				indent,
				source,
				end
			};
		}
	}
	function setScalarValue(token, value, context = {}) {
		let { afterKey = !1, implicitKey = !1, inFlow = !1, type } = context, indent = "indent" in token ? token.indent : null;
		if (afterKey && typeof indent == "number" && (indent += 2), !type) switch (token.type) {
			case "single-quoted-scalar":
				type = "QUOTE_SINGLE";
				break;
			case "double-quoted-scalar":
				type = "QUOTE_DOUBLE";
				break;
			case "block-scalar": {
				let header = token.props[0];
				if (header.type !== "block-scalar-header") throw Error("Invalid block scalar header");
				type = header.source[0] === ">" ? "BLOCK_FOLDED" : "BLOCK_LITERAL";
				break;
			}
			default: type = "PLAIN";
		}
		let source = stringifyString.stringifyString({
			type,
			value
		}, {
			implicitKey: implicitKey || indent === null,
			indent: indent !== null && indent > 0 ? " ".repeat(indent) : "",
			inFlow,
			options: {
				blockQuote: !0,
				lineWidth: -1
			}
		});
		switch (source[0]) {
			case "|":
			case ">":
				setBlockScalarValue(token, source);
				break;
			case "\"":
				setFlowScalarValue(token, source, "double-quoted-scalar");
				break;
			case "'":
				setFlowScalarValue(token, source, "single-quoted-scalar");
				break;
			default: setFlowScalarValue(token, source, "scalar");
		}
	}
	function setBlockScalarValue(token, source) {
		let he = source.indexOf("\n"), head = source.substring(0, he), body = source.substring(he + 1) + "\n";
		if (token.type === "block-scalar") {
			let header = token.props[0];
			if (header.type !== "block-scalar-header") throw Error("Invalid block scalar header");
			header.source = head, token.source = body;
		} else {
			let { offset } = token, indent = "indent" in token ? token.indent : -1, props = [{
				type: "block-scalar-header",
				offset,
				indent,
				source: head
			}];
			addEndtoBlockProps(props, "end" in token ? token.end : void 0) || props.push({
				type: "newline",
				offset: -1,
				indent,
				source: "\n"
			});
			for (let key of Object.keys(token)) key !== "type" && key !== "offset" && delete token[key];
			Object.assign(token, {
				type: "block-scalar",
				indent,
				props,
				source: body
			});
		}
	}
	function addEndtoBlockProps(props, end) {
		if (end) for (let st of end) switch (st.type) {
			case "space":
			case "comment":
				props.push(st);
				break;
			case "newline": return props.push(st), !0;
		}
		return !1;
	}
	function setFlowScalarValue(token, source, type) {
		switch (token.type) {
			case "scalar":
			case "double-quoted-scalar":
			case "single-quoted-scalar":
				token.type = type, token.source = source;
				break;
			case "block-scalar": {
				let end = token.props.slice(1), oa = source.length;
				token.props[0].type === "block-scalar-header" && (oa -= token.props[0].source.length);
				for (let tok of end) tok.offset += oa;
				delete token.props, Object.assign(token, {
					type,
					source,
					end
				});
				break;
			}
			case "block-map":
			case "block-seq": {
				let nl = {
					type: "newline",
					offset: token.offset + source.length,
					indent: token.indent,
					source: "\n"
				};
				delete token.items, Object.assign(token, {
					type,
					source,
					end: [nl]
				});
				break;
			}
			default: {
				let indent = "indent" in token ? token.indent : -1, end = "end" in token && Array.isArray(token.end) ? token.end.filter((st) => st.type === "space" || st.type === "comment" || st.type === "newline") : [];
				for (let key of Object.keys(token)) key !== "type" && key !== "offset" && delete token[key];
				Object.assign(token, {
					type,
					indent,
					source,
					end
				});
			}
		}
	}
	exports.createScalarToken = createScalarToken, exports.resolveAsScalar = resolveAsScalar, exports.setScalarValue = setScalarValue;
})), require_cst_stringify = __commonJSMin(((exports) => {
	let stringify = (cst) => "type" in cst ? stringifyToken(cst) : stringifyItem(cst);
	function stringifyToken(token) {
		switch (token.type) {
			case "block-scalar": {
				let res = "";
				for (let tok of token.props) res += stringifyToken(tok);
				return res + token.source;
			}
			case "block-map":
			case "block-seq": {
				let res = "";
				for (let item of token.items) res += stringifyItem(item);
				return res;
			}
			case "flow-collection": {
				let res = token.start.source;
				for (let item of token.items) res += stringifyItem(item);
				for (let st of token.end) res += st.source;
				return res;
			}
			case "document": {
				let res = stringifyItem(token);
				if (token.end) for (let st of token.end) res += st.source;
				return res;
			}
			default: {
				let res = token.source;
				if ("end" in token && token.end) for (let st of token.end) res += st.source;
				return res;
			}
		}
	}
	function stringifyItem({ start, key, sep, value }) {
		let res = "";
		for (let st of start) res += st.source;
		if (key && (res += stringifyToken(key)), sep) for (let st of sep) res += st.source;
		return value && (res += stringifyToken(value)), res;
	}
	exports.stringify = stringify;
})), require_cst_visit = __commonJSMin(((exports) => {
	let BREAK = Symbol("break visit"), SKIP = Symbol("skip children"), REMOVE = Symbol("remove item");
	function visit(cst, visitor) {
		"type" in cst && cst.type === "document" && (cst = {
			start: cst.start,
			value: cst.value
		}), _visit(Object.freeze([]), cst, visitor);
	}
	visit.BREAK = BREAK, visit.SKIP = SKIP, visit.REMOVE = REMOVE, visit.itemAtPath = (cst, path) => {
		let item = cst;
		for (let [field, index] of path) {
			let tok = item?.[field];
			if (tok && "items" in tok) item = tok.items[index];
			else return;
		}
		return item;
	}, visit.parentCollection = (cst, path) => {
		let parent = visit.itemAtPath(cst, path.slice(0, -1)), field = path[path.length - 1][0], coll = parent?.[field];
		if (coll && "items" in coll) return coll;
		throw Error("Parent collection not found");
	};
	function _visit(path, item, visitor) {
		let ctrl = visitor(item, path);
		if (typeof ctrl == "symbol") return ctrl;
		for (let field of ["key", "value"]) {
			let token = item[field];
			if (token && "items" in token) {
				for (let i = 0; i < token.items.length; ++i) {
					let ci = _visit(Object.freeze(path.concat([[field, i]])), token.items[i], visitor);
					if (typeof ci == "number") i = ci - 1;
					else if (ci === BREAK) return BREAK;
					else ci === REMOVE && (token.items.splice(i, 1), --i);
				}
				typeof ctrl == "function" && field === "key" && (ctrl = ctrl(item, path));
			}
		}
		return typeof ctrl == "function" ? ctrl(item, path) : ctrl;
	}
	exports.visit = visit;
})), require_cst = __commonJSMin(((exports) => {
	var cstScalar = require_cst_scalar(), cstStringify = require_cst_stringify(), cstVisit = require_cst_visit();
	let isCollection = (token) => !!token && "items" in token, isScalar = (token) => !!token && (token.type === "scalar" || token.type === "single-quoted-scalar" || token.type === "double-quoted-scalar" || token.type === "block-scalar");
	function prettyToken(token) {
		switch (token) {
			case "﻿": return "<BOM>";
			case "": return "<DOC>";
			case "": return "<FLOW_END>";
			case "": return "<SCALAR>";
			default: return JSON.stringify(token);
		}
	}
	function tokenType(source) {
		switch (source) {
			case "﻿": return "byte-order-mark";
			case "": return "doc-mode";
			case "": return "flow-error-end";
			case "": return "scalar";
			case "---": return "doc-start";
			case "...": return "doc-end";
			case "":
			case "\n":
			case "\r\n": return "newline";
			case "-": return "seq-item-ind";
			case "?": return "explicit-key-ind";
			case ":": return "map-value-ind";
			case "{": return "flow-map-start";
			case "}": return "flow-map-end";
			case "[": return "flow-seq-start";
			case "]": return "flow-seq-end";
			case ",": return "comma";
		}
		switch (source[0]) {
			case " ":
			case "	": return "space";
			case "#": return "comment";
			case "%": return "directive-line";
			case "*": return "alias";
			case "&": return "anchor";
			case "!": return "tag";
			case "'": return "single-quoted-scalar";
			case "\"": return "double-quoted-scalar";
			case "|":
			case ">": return "block-scalar-header";
		}
		return null;
	}
	exports.createScalarToken = cstScalar.createScalarToken, exports.resolveAsScalar = cstScalar.resolveAsScalar, exports.setScalarValue = cstScalar.setScalarValue, exports.stringify = cstStringify.stringify, exports.visit = cstVisit.visit, exports.BOM = "﻿", exports.DOCUMENT = "", exports.FLOW_END = "", exports.SCALAR = "", exports.isCollection = isCollection, exports.isScalar = isScalar, exports.prettyToken = prettyToken, exports.tokenType = tokenType;
})), require_lexer = __commonJSMin(((exports) => {
	var cst = require_cst();
	function isEmpty(ch) {
		switch (ch) {
			case void 0:
			case " ":
			case "\n":
			case "\r":
			case "	": return !0;
			default: return !1;
		}
	}
	let hexDigits = new Set("0123456789ABCDEFabcdef"), tagChars = new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*'()"), flowIndicatorChars = new Set(",[]{}"), invalidAnchorChars = new Set(" ,[]{}\n\r	"), isNotAnchorChar = (ch) => !ch || invalidAnchorChars.has(ch);
	exports.Lexer = class {
		constructor() {
			this.atEnd = !1, this.blockScalarIndent = -1, this.blockScalarKeep = !1, this.buffer = "", this.flowKey = !1, this.flowLevel = 0, this.indentNext = 0, this.indentValue = 0, this.lineEndPos = null, this.next = null, this.pos = 0;
		}
		*lex(source, incomplete = !1) {
			if (source) {
				if (typeof source != "string") throw TypeError("source is not a string");
				this.buffer = this.buffer ? this.buffer + source : source, this.lineEndPos = null;
			}
			this.atEnd = !incomplete;
			let next = this.next ?? "stream";
			for (; next && (incomplete || this.hasChars(1));) next = yield* this.parseNext(next);
		}
		atLineEnd() {
			let i = this.pos, ch = this.buffer[i];
			for (; ch === " " || ch === "	";) ch = this.buffer[++i];
			return !ch || ch === "#" || ch === "\n" || ch === "\r" && this.buffer[i + 1] === "\n";
		}
		charAt(n) {
			return this.buffer[this.pos + n];
		}
		continueScalar(offset) {
			let ch = this.buffer[offset];
			if (this.indentNext > 0) {
				let indent = 0;
				for (; ch === " ";) ch = this.buffer[++indent + offset];
				if (ch === "\r") {
					let next = this.buffer[indent + offset + 1];
					if (next === "\n" || !next && !this.atEnd) return offset + indent + 1;
				}
				return ch === "\n" || indent >= this.indentNext || !ch && !this.atEnd ? offset + indent : -1;
			}
			if (ch === "-" || ch === ".") {
				let dt = this.buffer.substr(offset, 3);
				if ((dt === "---" || dt === "...") && isEmpty(this.buffer[offset + 3])) return -1;
			}
			return offset;
		}
		getLine() {
			let end = this.lineEndPos;
			return (typeof end != "number" || end !== -1 && end < this.pos) && (end = this.buffer.indexOf("\n", this.pos), this.lineEndPos = end), end === -1 ? this.atEnd ? this.buffer.substring(this.pos) : null : (this.buffer[end - 1] === "\r" && --end, this.buffer.substring(this.pos, end));
		}
		hasChars(n) {
			return this.pos + n <= this.buffer.length;
		}
		setNext(state) {
			return this.buffer = this.buffer.substring(this.pos), this.pos = 0, this.lineEndPos = null, this.next = state, null;
		}
		peek(n) {
			return this.buffer.substr(this.pos, n);
		}
		*parseNext(next) {
			switch (next) {
				case "stream": return yield* this.parseStream();
				case "line-start": return yield* this.parseLineStart();
				case "block-start": return yield* this.parseBlockStart();
				case "doc": return yield* this.parseDocument();
				case "flow": return yield* this.parseFlowCollection();
				case "quoted-scalar": return yield* this.parseQuotedScalar();
				case "block-scalar": return yield* this.parseBlockScalar();
				case "plain-scalar": return yield* this.parsePlainScalar();
			}
		}
		*parseStream() {
			let line = this.getLine();
			if (line === null) return this.setNext("stream");
			if (line[0] === cst.BOM && (yield* this.pushCount(1), line = line.substring(1)), line[0] === "%") {
				let dirEnd = line.length, cs = line.indexOf("#");
				for (; cs !== -1;) {
					let ch = line[cs - 1];
					if (ch === " " || ch === "	") {
						dirEnd = cs - 1;
						break;
					}
					cs = line.indexOf("#", cs + 1);
				}
				for (;;) {
					let ch = line[dirEnd - 1];
					if (ch === " " || ch === "	") --dirEnd;
					else break;
				}
				let n = (yield* this.pushCount(dirEnd)) + (yield* this.pushSpaces(!0));
				return yield* this.pushCount(line.length - n), this.pushNewline(), "stream";
			}
			if (this.atLineEnd()) {
				let sp = yield* this.pushSpaces(!0);
				return yield* this.pushCount(line.length - sp), yield* this.pushNewline(), "stream";
			}
			return yield cst.DOCUMENT, yield* this.parseLineStart();
		}
		*parseLineStart() {
			let ch = this.charAt(0);
			if (!ch && !this.atEnd) return this.setNext("line-start");
			if (ch === "-" || ch === ".") {
				if (!this.atEnd && !this.hasChars(4)) return this.setNext("line-start");
				let s = this.peek(3);
				if ((s === "---" || s === "...") && isEmpty(this.charAt(3))) return yield* this.pushCount(3), this.indentValue = 0, this.indentNext = 0, s === "---" ? "doc" : "stream";
			}
			return this.indentValue = yield* this.pushSpaces(!1), this.indentNext > this.indentValue && !isEmpty(this.charAt(1)) && (this.indentNext = this.indentValue), yield* this.parseBlockStart();
		}
		*parseBlockStart() {
			let [ch0, ch1] = this.peek(2);
			if (!ch1 && !this.atEnd) return this.setNext("block-start");
			if ((ch0 === "-" || ch0 === "?" || ch0 === ":") && isEmpty(ch1)) {
				let n = (yield* this.pushCount(1)) + (yield* this.pushSpaces(!0));
				return this.indentNext = this.indentValue + 1, this.indentValue += n, "block-start";
			}
			return "doc";
		}
		*parseDocument() {
			yield* this.pushSpaces(!0);
			let line = this.getLine();
			if (line === null) return this.setNext("doc");
			let n = yield* this.pushIndicators();
			switch (line[n]) {
				case "#": yield* this.pushCount(line.length - n);
				case void 0: return yield* this.pushNewline(), yield* this.parseLineStart();
				case "{":
				case "[": return yield* this.pushCount(1), this.flowKey = !1, this.flowLevel = 1, "flow";
				case "}":
				case "]": return yield* this.pushCount(1), "doc";
				case "*": return yield* this.pushUntil(isNotAnchorChar), "doc";
				case "\"":
				case "'": return yield* this.parseQuotedScalar();
				case "|":
				case ">": return n += yield* this.parseBlockScalarHeader(), n += yield* this.pushSpaces(!0), yield* this.pushCount(line.length - n), yield* this.pushNewline(), yield* this.parseBlockScalar();
				default: return yield* this.parsePlainScalar();
			}
		}
		*parseFlowCollection() {
			let nl, sp, indent = -1;
			do
				nl = yield* this.pushNewline(), nl > 0 ? (sp = yield* this.pushSpaces(!1), this.indentValue = indent = sp) : sp = 0, sp += yield* this.pushSpaces(!0);
			while (nl + sp > 0);
			let line = this.getLine();
			if (line === null) return this.setNext("flow");
			if ((indent !== -1 && indent < this.indentNext && line[0] !== "#" || indent === 0 && (line.startsWith("---") || line.startsWith("...")) && isEmpty(line[3])) && (indent !== this.indentNext - 1 || this.flowLevel !== 1 || line[0] !== "]" && line[0] !== "}")) return this.flowLevel = 0, yield cst.FLOW_END, yield* this.parseLineStart();
			let n = 0;
			for (; line[n] === ",";) n += yield* this.pushCount(1), n += yield* this.pushSpaces(!0), this.flowKey = !1;
			switch (n += yield* this.pushIndicators(), line[n]) {
				case void 0: return "flow";
				case "#": return yield* this.pushCount(line.length - n), "flow";
				case "{":
				case "[": return yield* this.pushCount(1), this.flowKey = !1, this.flowLevel += 1, "flow";
				case "}":
				case "]": return yield* this.pushCount(1), this.flowKey = !0, --this.flowLevel, this.flowLevel ? "flow" : "doc";
				case "*": return yield* this.pushUntil(isNotAnchorChar), "flow";
				case "\"":
				case "'": return this.flowKey = !0, yield* this.parseQuotedScalar();
				case ":": {
					let next = this.charAt(1);
					if (this.flowKey || isEmpty(next) || next === ",") return this.flowKey = !1, yield* this.pushCount(1), yield* this.pushSpaces(!0), "flow";
				}
				default: return this.flowKey = !1, yield* this.parsePlainScalar();
			}
		}
		*parseQuotedScalar() {
			let quote = this.charAt(0), end = this.buffer.indexOf(quote, this.pos + 1);
			if (quote === "'") for (; end !== -1 && this.buffer[end + 1] === "'";) end = this.buffer.indexOf("'", end + 2);
			else for (; end !== -1;) {
				let n = 0;
				for (; this.buffer[end - 1 - n] === "\\";) n += 1;
				if (n % 2 == 0) break;
				end = this.buffer.indexOf("\"", end + 1);
			}
			let qb = this.buffer.substring(0, end), nl = qb.indexOf("\n", this.pos);
			if (nl !== -1) {
				for (; nl !== -1;) {
					let cs = this.continueScalar(nl + 1);
					if (cs === -1) break;
					nl = qb.indexOf("\n", cs);
				}
				nl !== -1 && (end = nl - (qb[nl - 1] === "\r" ? 2 : 1));
			}
			if (end === -1) {
				if (!this.atEnd) return this.setNext("quoted-scalar");
				end = this.buffer.length;
			}
			return yield* this.pushToIndex(end + 1, !1), this.flowLevel ? "flow" : "doc";
		}
		*parseBlockScalarHeader() {
			this.blockScalarIndent = -1, this.blockScalarKeep = !1;
			let i = this.pos;
			for (;;) {
				let ch = this.buffer[++i];
				if (ch === "+") this.blockScalarKeep = !0;
				else if (ch > "0" && ch <= "9") this.blockScalarIndent = Number(ch) - 1;
				else if (ch !== "-") break;
			}
			return yield* this.pushUntil((ch) => isEmpty(ch) || ch === "#");
		}
		*parseBlockScalar() {
			let nl = this.pos - 1, indent = 0, ch;
			loop: for (let i = this.pos; ch = this.buffer[i]; ++i) switch (ch) {
				case " ":
					indent += 1;
					break;
				case "\n":
					nl = i, indent = 0;
					break;
				case "\r": {
					let next = this.buffer[i + 1];
					if (!next && !this.atEnd) return this.setNext("block-scalar");
					if (next === "\n") break;
				}
				default: break loop;
			}
			if (!ch && !this.atEnd) return this.setNext("block-scalar");
			if (indent >= this.indentNext) {
				this.indentNext = this.blockScalarIndent === -1 ? indent : this.blockScalarIndent + (this.indentNext === 0 ? 1 : this.indentNext);
				do {
					let cs = this.continueScalar(nl + 1);
					if (cs === -1) break;
					nl = this.buffer.indexOf("\n", cs);
				} while (nl !== -1);
				if (nl === -1) {
					if (!this.atEnd) return this.setNext("block-scalar");
					nl = this.buffer.length;
				}
			}
			let i = nl + 1;
			for (ch = this.buffer[i]; ch === " ";) ch = this.buffer[++i];
			if (ch === "	") {
				for (; ch === "	" || ch === " " || ch === "\r" || ch === "\n";) ch = this.buffer[++i];
				nl = i - 1;
			} else if (!this.blockScalarKeep) do {
				let i = nl - 1, ch = this.buffer[i];
				ch === "\r" && (ch = this.buffer[--i]);
				let lastChar = i;
				for (; ch === " ";) ch = this.buffer[--i];
				if (ch === "\n" && i >= this.pos && i + 1 + indent > lastChar) nl = i;
				else break;
			} while (1);
			return yield cst.SCALAR, yield* this.pushToIndex(nl + 1, !0), yield* this.parseLineStart();
		}
		*parsePlainScalar() {
			let inFlow = this.flowLevel > 0, end = this.pos - 1, i = this.pos - 1, ch;
			for (; ch = this.buffer[++i];) if (ch === ":") {
				let next = this.buffer[i + 1];
				if (isEmpty(next) || inFlow && flowIndicatorChars.has(next)) break;
				end = i;
			} else if (isEmpty(ch)) {
				let next = this.buffer[i + 1];
				if (ch === "\r" && (next === "\n" ? (i += 1, ch = "\n", next = this.buffer[i + 1]) : end = i), next === "#" || inFlow && flowIndicatorChars.has(next)) break;
				if (ch === "\n") {
					let cs = this.continueScalar(i + 1);
					if (cs === -1) break;
					i = Math.max(i, cs - 2);
				}
			} else {
				if (inFlow && flowIndicatorChars.has(ch)) break;
				end = i;
			}
			return !ch && !this.atEnd ? this.setNext("plain-scalar") : (yield cst.SCALAR, yield* this.pushToIndex(end + 1, !0), inFlow ? "flow" : "doc");
		}
		*pushCount(n) {
			return n > 0 ? (yield this.buffer.substr(this.pos, n), this.pos += n, n) : 0;
		}
		*pushToIndex(i, allowEmpty) {
			let s = this.buffer.slice(this.pos, i);
			return s ? (yield s, this.pos += s.length, s.length) : (allowEmpty && (yield ""), 0);
		}
		*pushIndicators() {
			let n = 0;
			loop: for (;;) {
				switch (this.charAt(0)) {
					case "!":
						n += yield* this.pushTag(), n += yield* this.pushSpaces(!0);
						continue loop;
					case "&":
						n += yield* this.pushUntil(isNotAnchorChar), n += yield* this.pushSpaces(!0);
						continue loop;
					case "-":
					case "?":
					case ":": {
						let inFlow = this.flowLevel > 0, ch1 = this.charAt(1);
						if (isEmpty(ch1) || inFlow && flowIndicatorChars.has(ch1)) {
							inFlow ? this.flowKey &&= !1 : this.indentNext = this.indentValue + 1, n += yield* this.pushCount(1), n += yield* this.pushSpaces(!0);
							continue loop;
						}
					}
				}
				break loop;
			}
			return n;
		}
		*pushTag() {
			if (this.charAt(1) === "<") {
				let i = this.pos + 2, ch = this.buffer[i];
				for (; !isEmpty(ch) && ch !== ">";) ch = this.buffer[++i];
				return yield* this.pushToIndex(ch === ">" ? i + 1 : i, !1);
			}
			{
				let i = this.pos + 1, ch = this.buffer[i];
				for (; ch;) if (tagChars.has(ch)) ch = this.buffer[++i];
				else if (ch === "%" && hexDigits.has(this.buffer[i + 1]) && hexDigits.has(this.buffer[i + 2])) ch = this.buffer[i += 3];
				else break;
				return yield* this.pushToIndex(i, !1);
			}
		}
		*pushNewline() {
			let ch = this.buffer[this.pos];
			return ch === "\n" ? yield* this.pushCount(1) : ch === "\r" && this.charAt(1) === "\n" ? yield* this.pushCount(2) : 0;
		}
		*pushSpaces(allowTabs) {
			let i = this.pos - 1, ch;
			do
				ch = this.buffer[++i];
			while (ch === " " || allowTabs && ch === "	");
			let n = i - this.pos;
			return n > 0 && (yield this.buffer.substr(this.pos, n), this.pos = i), n;
		}
		*pushUntil(test) {
			let i = this.pos, ch = this.buffer[i];
			for (; !test(ch);) ch = this.buffer[++i];
			return yield* this.pushToIndex(i, !1);
		}
	};
})), require_line_counter = __commonJSMin(((exports) => {
	exports.LineCounter = class {
		constructor() {
			this.lineStarts = [], this.addNewLine = (offset) => this.lineStarts.push(offset), this.linePos = (offset) => {
				let low = 0, high = this.lineStarts.length;
				for (; low < high;) {
					let mid = low + high >> 1;
					this.lineStarts[mid] < offset ? low = mid + 1 : high = mid;
				}
				if (this.lineStarts[low] === offset) return {
					line: low + 1,
					col: 1
				};
				if (low === 0) return {
					line: 0,
					col: offset
				};
				let start = this.lineStarts[low - 1];
				return {
					line: low,
					col: offset - start + 1
				};
			};
		}
	};
})), require_parser = __commonJSMin(((exports) => {
	var node_process = require("process"), cst = require_cst(), lexer = require_lexer();
	function includesToken(list, type) {
		for (let i = 0; i < list.length; ++i) if (list[i].type === type) return !0;
		return !1;
	}
	function findNonEmptyIndex(list) {
		for (let i = 0; i < list.length; ++i) switch (list[i].type) {
			case "space":
			case "comment":
			case "newline": break;
			default: return i;
		}
		return -1;
	}
	function isFlowToken(token) {
		switch (token?.type) {
			case "alias":
			case "scalar":
			case "single-quoted-scalar":
			case "double-quoted-scalar":
			case "flow-collection": return !0;
			default: return !1;
		}
	}
	function getPrevProps(parent) {
		switch (parent.type) {
			case "document": return parent.start;
			case "block-map": {
				let it = parent.items[parent.items.length - 1];
				return it.sep ?? it.start;
			}
			case "block-seq": return parent.items[parent.items.length - 1].start;
			default: return [];
		}
	}
	function getFirstKeyStartProps(prev) {
		if (prev.length === 0) return [];
		let i = prev.length;
		loop: for (; --i >= 0;) switch (prev[i].type) {
			case "doc-start":
			case "explicit-key-ind":
			case "map-value-ind":
			case "seq-item-ind":
			case "newline": break loop;
		}
		for (; prev[++i]?.type === "space";);
		return prev.splice(i, prev.length);
	}
	function arrayPushArray(target, source) {
		if (source.length < 1e5) Array.prototype.push.apply(target, source);
		else for (let i = 0; i < source.length; ++i) target.push(source[i]);
	}
	function fixFlowSeqItems(fc) {
		if (fc.start.type === "flow-seq-start") for (let it of fc.items) it.sep && !it.value && !includesToken(it.start, "explicit-key-ind") && !includesToken(it.sep, "map-value-ind") && (it.key && (it.value = it.key), delete it.key, isFlowToken(it.value) ? it.value.end ? arrayPushArray(it.value.end, it.sep) : it.value.end = it.sep : arrayPushArray(it.start, it.sep), delete it.sep);
	}
	exports.Parser = class {
		constructor(onNewLine) {
			this.atNewLine = !0, this.atScalar = !1, this.indent = 0, this.offset = 0, this.onKeyLine = !1, this.stack = [], this.source = "", this.type = "", this.lexer = new lexer.Lexer(), this.onNewLine = onNewLine;
		}
		*parse(source, incomplete = !1) {
			this.onNewLine && this.offset === 0 && this.onNewLine(0);
			for (let lexeme of this.lexer.lex(source, incomplete)) yield* this.next(lexeme);
			incomplete || (yield* this.end());
		}
		*next(source) {
			if (this.source = source, node_process.env.LOG_TOKENS && console.log("|", cst.prettyToken(source)), this.atScalar) {
				this.atScalar = !1, yield* this.step(), this.offset += source.length;
				return;
			}
			let type = cst.tokenType(source);
			if (!type) {
				let message = `Not a YAML token: ${source}`;
				yield* this.pop({
					type: "error",
					offset: this.offset,
					message,
					source
				}), this.offset += source.length;
			} else if (type === "scalar") this.atNewLine = !1, this.atScalar = !0, this.type = "scalar";
			else {
				switch (this.type = type, yield* this.step(), type) {
					case "newline":
						this.atNewLine = !0, this.indent = 0, this.onNewLine && this.onNewLine(this.offset + source.length);
						break;
					case "space":
						this.atNewLine && source[0] === " " && (this.indent += source.length);
						break;
					case "explicit-key-ind":
					case "map-value-ind":
					case "seq-item-ind":
						this.atNewLine && (this.indent += source.length);
						break;
					case "doc-mode":
					case "flow-error-end": return;
					default: this.atNewLine = !1;
				}
				this.offset += source.length;
			}
		}
		*end() {
			for (; this.stack.length > 0;) yield* this.pop();
		}
		get sourceToken() {
			return {
				type: this.type,
				offset: this.offset,
				indent: this.indent,
				source: this.source
			};
		}
		*step() {
			let top = this.peek(1);
			if (this.type === "doc-end" && top?.type !== "doc-end") {
				for (; this.stack.length > 0;) yield* this.pop();
				this.stack.push({
					type: "doc-end",
					offset: this.offset,
					source: this.source
				});
				return;
			}
			if (!top) return yield* this.stream();
			switch (top.type) {
				case "document": return yield* this.document(top);
				case "alias":
				case "scalar":
				case "single-quoted-scalar":
				case "double-quoted-scalar": return yield* this.scalar(top);
				case "block-scalar": return yield* this.blockScalar(top);
				case "block-map": return yield* this.blockMap(top);
				case "block-seq": return yield* this.blockSequence(top);
				case "flow-collection": return yield* this.flowCollection(top);
				case "doc-end": return yield* this.documentEnd(top);
			}
			yield* this.pop();
		}
		peek(n) {
			return this.stack[this.stack.length - n];
		}
		*pop(error) {
			let token = error ?? this.stack.pop();
			if (!token) yield {
				type: "error",
				offset: this.offset,
				source: "",
				message: "Tried to pop an empty stack"
			};
			else if (this.stack.length === 0) yield token;
			else {
				let top = this.peek(1);
				switch (token.type === "block-scalar" ? token.indent = "indent" in top ? top.indent : 0 : token.type === "flow-collection" && top.type === "document" && (token.indent = 0), token.type === "flow-collection" && fixFlowSeqItems(token), top.type) {
					case "document":
						top.value = token;
						break;
					case "block-scalar":
						top.props.push(token);
						break;
					case "block-map": {
						let it = top.items[top.items.length - 1];
						if (it.value) {
							top.items.push({
								start: [],
								key: token,
								sep: []
							}), this.onKeyLine = !0;
							return;
						}
						if (it.sep) it.value = token;
						else {
							Object.assign(it, {
								key: token,
								sep: []
							}), this.onKeyLine = !it.explicitKey;
							return;
						}
						break;
					}
					case "block-seq": {
						let it = top.items[top.items.length - 1];
						it.value ? top.items.push({
							start: [],
							value: token
						}) : it.value = token;
						break;
					}
					case "flow-collection": {
						let it = top.items[top.items.length - 1];
						!it || it.value ? top.items.push({
							start: [],
							key: token,
							sep: []
						}) : it.sep ? it.value = token : Object.assign(it, {
							key: token,
							sep: []
						});
						return;
					}
					default: yield* this.pop(), yield* this.pop(token);
				}
				if ((top.type === "document" || top.type === "block-map" || top.type === "block-seq") && (token.type === "block-map" || token.type === "block-seq")) {
					let last = token.items[token.items.length - 1];
					last && !last.sep && !last.value && last.start.length > 0 && findNonEmptyIndex(last.start) === -1 && (token.indent === 0 || last.start.every((st) => st.type !== "comment" || st.indent < token.indent)) && (top.type === "document" ? top.end = last.start : top.items.push({ start: last.start }), token.items.splice(-1, 1));
				}
			}
		}
		*stream() {
			switch (this.type) {
				case "directive-line":
					yield {
						type: "directive",
						offset: this.offset,
						source: this.source
					};
					return;
				case "byte-order-mark":
				case "space":
				case "comment":
				case "newline":
					yield this.sourceToken;
					return;
				case "doc-mode":
				case "doc-start": {
					let doc = {
						type: "document",
						offset: this.offset,
						start: []
					};
					this.type === "doc-start" && doc.start.push(this.sourceToken), this.stack.push(doc);
					return;
				}
			}
			yield {
				type: "error",
				offset: this.offset,
				message: `Unexpected ${this.type} token in YAML stream`,
				source: this.source
			};
		}
		*document(doc) {
			if (doc.value) return yield* this.lineEnd(doc);
			switch (this.type) {
				case "doc-start":
					findNonEmptyIndex(doc.start) === -1 ? doc.start.push(this.sourceToken) : (yield* this.pop(), yield* this.step());
					return;
				case "anchor":
				case "tag":
				case "space":
				case "comment":
				case "newline":
					doc.start.push(this.sourceToken);
					return;
			}
			let bv = this.startBlockValue(doc);
			bv ? this.stack.push(bv) : yield {
				type: "error",
				offset: this.offset,
				message: `Unexpected ${this.type} token in YAML document`,
				source: this.source
			};
		}
		*scalar(scalar) {
			if (this.type === "map-value-ind") {
				let start = getFirstKeyStartProps(getPrevProps(this.peek(2))), sep;
				scalar.end ? (sep = scalar.end, sep.push(this.sourceToken), delete scalar.end) : sep = [this.sourceToken];
				let map = {
					type: "block-map",
					offset: scalar.offset,
					indent: scalar.indent,
					items: [{
						start,
						key: scalar,
						sep
					}]
				};
				this.onKeyLine = !0, this.stack[this.stack.length - 1] = map;
			} else yield* this.lineEnd(scalar);
		}
		*blockScalar(scalar) {
			switch (this.type) {
				case "space":
				case "comment":
				case "newline":
					scalar.props.push(this.sourceToken);
					return;
				case "scalar":
					if (scalar.source = this.source, this.atNewLine = !0, this.indent = 0, this.onNewLine) {
						let nl = this.source.indexOf("\n") + 1;
						for (; nl !== 0;) this.onNewLine(this.offset + nl), nl = this.source.indexOf("\n", nl) + 1;
					}
					yield* this.pop();
					break;
				default: yield* this.pop(), yield* this.step();
			}
		}
		*blockMap(map) {
			let it = map.items[map.items.length - 1];
			switch (this.type) {
				case "newline":
					if (this.onKeyLine = !1, it.value) {
						let end = "end" in it.value ? it.value.end : void 0;
						(Array.isArray(end) ? end[end.length - 1] : void 0)?.type === "comment" ? end?.push(this.sourceToken) : map.items.push({ start: [this.sourceToken] });
					} else it.sep ? it.sep.push(this.sourceToken) : it.start.push(this.sourceToken);
					return;
				case "space":
				case "comment":
					if (it.value) map.items.push({ start: [this.sourceToken] });
					else if (it.sep) it.sep.push(this.sourceToken);
					else {
						if (this.atIndentedComment(it.start, map.indent)) {
							let end = map.items[map.items.length - 2]?.value?.end;
							if (Array.isArray(end)) {
								arrayPushArray(end, it.start), end.push(this.sourceToken), map.items.pop();
								return;
							}
						}
						it.start.push(this.sourceToken);
					}
					return;
			}
			if (this.indent >= map.indent) {
				let atMapIndent = !this.onKeyLine && this.indent === map.indent, atNextItem = atMapIndent && (it.sep || it.explicitKey) && this.type !== "seq-item-ind", start = [];
				if (atNextItem && it.sep && !it.value) {
					let nl = [];
					for (let i = 0; i < it.sep.length; ++i) {
						let st = it.sep[i];
						switch (st.type) {
							case "newline":
								nl.push(i);
								break;
							case "space": break;
							case "comment":
								st.indent > map.indent && (nl.length = 0);
								break;
							default: nl.length = 0;
						}
					}
					nl.length >= 2 && (start = it.sep.splice(nl[1]));
				}
				switch (this.type) {
					case "anchor":
					case "tag":
						atNextItem || it.value ? (start.push(this.sourceToken), map.items.push({ start }), this.onKeyLine = !0) : it.sep ? it.sep.push(this.sourceToken) : it.start.push(this.sourceToken);
						return;
					case "explicit-key-ind":
						!it.sep && !it.explicitKey ? (it.start.push(this.sourceToken), it.explicitKey = !0) : atNextItem || it.value ? (start.push(this.sourceToken), map.items.push({
							start,
							explicitKey: !0
						})) : this.stack.push({
							type: "block-map",
							offset: this.offset,
							indent: this.indent,
							items: [{
								start: [this.sourceToken],
								explicitKey: !0
							}]
						}), this.onKeyLine = !0;
						return;
					case "map-value-ind":
						if (it.explicitKey) {
							if (!it.sep) {
								if (includesToken(it.start, "newline")) Object.assign(it, {
									key: null,
									sep: [this.sourceToken]
								});
								else {
									let start = getFirstKeyStartProps(it.start);
									this.stack.push({
										type: "block-map",
										offset: this.offset,
										indent: this.indent,
										items: [{
											start,
											key: null,
											sep: [this.sourceToken]
										}]
									});
								}
							} else if (it.value) map.items.push({
								start: [],
								key: null,
								sep: [this.sourceToken]
							});
							else if (includesToken(it.sep, "map-value-ind")) this.stack.push({
								type: "block-map",
								offset: this.offset,
								indent: this.indent,
								items: [{
									start,
									key: null,
									sep: [this.sourceToken]
								}]
							});
							else if (isFlowToken(it.key) && !includesToken(it.sep, "newline")) {
								let start = getFirstKeyStartProps(it.start), key = it.key, sep = it.sep;
								sep.push(this.sourceToken), delete it.key, delete it.sep, this.stack.push({
									type: "block-map",
									offset: this.offset,
									indent: this.indent,
									items: [{
										start,
										key,
										sep
									}]
								});
							} else start.length > 0 ? it.sep = it.sep.concat(start, this.sourceToken) : it.sep.push(this.sourceToken);
						} else it.sep ? it.value || atNextItem ? map.items.push({
							start,
							key: null,
							sep: [this.sourceToken]
						}) : includesToken(it.sep, "map-value-ind") ? this.stack.push({
							type: "block-map",
							offset: this.offset,
							indent: this.indent,
							items: [{
								start: [],
								key: null,
								sep: [this.sourceToken]
							}]
						}) : it.sep.push(this.sourceToken) : Object.assign(it, {
							key: null,
							sep: [this.sourceToken]
						});
						this.onKeyLine = !0;
						return;
					case "alias":
					case "scalar":
					case "single-quoted-scalar":
					case "double-quoted-scalar": {
						let fs = this.flowScalar(this.type);
						atNextItem || it.value ? (map.items.push({
							start,
							key: fs,
							sep: []
						}), this.onKeyLine = !0) : it.sep ? this.stack.push(fs) : (Object.assign(it, {
							key: fs,
							sep: []
						}), this.onKeyLine = !0);
						return;
					}
					default: {
						let bv = this.startBlockValue(map);
						if (bv) {
							if (bv.type === "block-seq") {
								if (!it.explicitKey && it.sep && !includesToken(it.sep, "newline")) {
									yield* this.pop({
										type: "error",
										offset: this.offset,
										message: "Unexpected block-seq-ind on same line with key",
										source: this.source
									});
									return;
								}
							} else atMapIndent && map.items.push({ start });
							this.stack.push(bv);
							return;
						}
					}
				}
			}
			yield* this.pop(), yield* this.step();
		}
		*blockSequence(seq) {
			let it = seq.items[seq.items.length - 1];
			switch (this.type) {
				case "newline":
					if (it.value) {
						let end = "end" in it.value ? it.value.end : void 0;
						(Array.isArray(end) ? end[end.length - 1] : void 0)?.type === "comment" ? end?.push(this.sourceToken) : seq.items.push({ start: [this.sourceToken] });
					} else it.start.push(this.sourceToken);
					return;
				case "space":
				case "comment":
					if (it.value) seq.items.push({ start: [this.sourceToken] });
					else {
						if (this.atIndentedComment(it.start, seq.indent)) {
							let end = seq.items[seq.items.length - 2]?.value?.end;
							if (Array.isArray(end)) {
								arrayPushArray(end, it.start), end.push(this.sourceToken), seq.items.pop();
								return;
							}
						}
						it.start.push(this.sourceToken);
					}
					return;
				case "anchor":
				case "tag":
					if (it.value || this.indent <= seq.indent) break;
					it.start.push(this.sourceToken);
					return;
				case "seq-item-ind":
					if (this.indent !== seq.indent) break;
					it.value || includesToken(it.start, "seq-item-ind") ? seq.items.push({ start: [this.sourceToken] }) : it.start.push(this.sourceToken);
					return;
			}
			if (this.indent > seq.indent) {
				let bv = this.startBlockValue(seq);
				if (bv) {
					this.stack.push(bv);
					return;
				}
			}
			yield* this.pop(), yield* this.step();
		}
		*flowCollection(fc) {
			let it = fc.items[fc.items.length - 1];
			if (this.type === "flow-error-end") {
				let top;
				do
					yield* this.pop(), top = this.peek(1);
				while (top?.type === "flow-collection");
			} else if (fc.end.length === 0) {
				switch (this.type) {
					case "comma":
					case "explicit-key-ind":
						!it || it.sep ? fc.items.push({ start: [this.sourceToken] }) : it.start.push(this.sourceToken);
						return;
					case "map-value-ind":
						!it || it.value ? fc.items.push({
							start: [],
							key: null,
							sep: [this.sourceToken]
						}) : it.sep ? it.sep.push(this.sourceToken) : Object.assign(it, {
							key: null,
							sep: [this.sourceToken]
						});
						return;
					case "space":
					case "comment":
					case "newline":
					case "anchor":
					case "tag":
						!it || it.value ? fc.items.push({ start: [this.sourceToken] }) : it.sep ? it.sep.push(this.sourceToken) : it.start.push(this.sourceToken);
						return;
					case "alias":
					case "scalar":
					case "single-quoted-scalar":
					case "double-quoted-scalar": {
						let fs = this.flowScalar(this.type);
						!it || it.value ? fc.items.push({
							start: [],
							key: fs,
							sep: []
						}) : it.sep ? this.stack.push(fs) : Object.assign(it, {
							key: fs,
							sep: []
						});
						return;
					}
					case "flow-map-end":
					case "flow-seq-end":
						fc.end.push(this.sourceToken);
						return;
				}
				let bv = this.startBlockValue(fc);
				bv ? this.stack.push(bv) : (yield* this.pop(), yield* this.step());
			} else {
				let parent = this.peek(2);
				if (parent.type === "block-map" && (this.type === "map-value-ind" && parent.indent === fc.indent || this.type === "newline" && !parent.items[parent.items.length - 1].sep)) yield* this.pop(), yield* this.step();
				else if (this.type === "map-value-ind" && parent.type !== "flow-collection") {
					let start = getFirstKeyStartProps(getPrevProps(parent));
					fixFlowSeqItems(fc);
					let sep = fc.end.splice(1, fc.end.length);
					sep.push(this.sourceToken);
					let map = {
						type: "block-map",
						offset: fc.offset,
						indent: fc.indent,
						items: [{
							start,
							key: fc,
							sep
						}]
					};
					this.onKeyLine = !0, this.stack[this.stack.length - 1] = map;
				} else yield* this.lineEnd(fc);
			}
		}
		flowScalar(type) {
			if (this.onNewLine) {
				let nl = this.source.indexOf("\n") + 1;
				for (; nl !== 0;) this.onNewLine(this.offset + nl), nl = this.source.indexOf("\n", nl) + 1;
			}
			return {
				type,
				offset: this.offset,
				indent: this.indent,
				source: this.source
			};
		}
		startBlockValue(parent) {
			switch (this.type) {
				case "alias":
				case "scalar":
				case "single-quoted-scalar":
				case "double-quoted-scalar": return this.flowScalar(this.type);
				case "block-scalar-header": return {
					type: "block-scalar",
					offset: this.offset,
					indent: this.indent,
					props: [this.sourceToken],
					source: ""
				};
				case "flow-map-start":
				case "flow-seq-start": return {
					type: "flow-collection",
					offset: this.offset,
					indent: this.indent,
					start: this.sourceToken,
					items: [],
					end: []
				};
				case "seq-item-ind": return {
					type: "block-seq",
					offset: this.offset,
					indent: this.indent,
					items: [{ start: [this.sourceToken] }]
				};
				case "explicit-key-ind": {
					this.onKeyLine = !0;
					let start = getFirstKeyStartProps(getPrevProps(parent));
					return start.push(this.sourceToken), {
						type: "block-map",
						offset: this.offset,
						indent: this.indent,
						items: [{
							start,
							explicitKey: !0
						}]
					};
				}
				case "map-value-ind": {
					this.onKeyLine = !0;
					let start = getFirstKeyStartProps(getPrevProps(parent));
					return {
						type: "block-map",
						offset: this.offset,
						indent: this.indent,
						items: [{
							start,
							key: null,
							sep: [this.sourceToken]
						}]
					};
				}
			}
			return null;
		}
		atIndentedComment(start, indent) {
			return this.type !== "comment" || this.indent <= indent ? !1 : start.every((st) => st.type === "newline" || st.type === "space");
		}
		*documentEnd(docEnd) {
			this.type !== "doc-mode" && (docEnd.end ? docEnd.end.push(this.sourceToken) : docEnd.end = [this.sourceToken], this.type === "newline" && (yield* this.pop()));
		}
		*lineEnd(token) {
			switch (this.type) {
				case "comma":
				case "doc-start":
				case "doc-end":
				case "flow-seq-end":
				case "flow-map-end":
				case "map-value-ind":
					yield* this.pop(), yield* this.step();
					break;
				case "newline": this.onKeyLine = !1;
				default: token.end ? token.end.push(this.sourceToken) : token.end = [this.sourceToken], this.type === "newline" && (yield* this.pop());
			}
		}
	};
})), require_public_api = __commonJSMin(((exports) => {
	var composer = require_composer(), Document = require_Document(), errors = require_errors(), log = require_log(), identity = require_identity(), lineCounter = require_line_counter(), parser = require_parser();
	function parseOptions(options) {
		let prettyErrors = options.prettyErrors !== !1;
		return {
			lineCounter: options.lineCounter || prettyErrors && new lineCounter.LineCounter() || null,
			prettyErrors
		};
	}
	function parseAllDocuments(source, options = {}) {
		let { lineCounter, prettyErrors } = parseOptions(options), parser$1 = new parser.Parser(lineCounter?.addNewLine), composer$1 = new composer.Composer(options), docs = Array.from(composer$1.compose(parser$1.parse(source)));
		if (prettyErrors && lineCounter) for (let doc of docs) doc.errors.forEach(errors.prettifyError(source, lineCounter)), doc.warnings.forEach(errors.prettifyError(source, lineCounter));
		return docs.length > 0 ? docs : Object.assign([], { empty: !0 }, composer$1.streamInfo());
	}
	function parseDocument(source, options = {}) {
		let { lineCounter, prettyErrors } = parseOptions(options), parser$1 = new parser.Parser(lineCounter?.addNewLine), composer$1 = new composer.Composer(options), doc = null;
		for (let _doc of composer$1.compose(parser$1.parse(source), !0, source.length)) if (!doc) doc = _doc;
		else if (doc.options.logLevel !== "silent") {
			doc.errors.push(new errors.YAMLParseError(_doc.range.slice(0, 2), "MULTIPLE_DOCS", "Source contains multiple documents; please use YAML.parseAllDocuments()"));
			break;
		}
		return prettyErrors && lineCounter && (doc.errors.forEach(errors.prettifyError(source, lineCounter)), doc.warnings.forEach(errors.prettifyError(source, lineCounter))), doc;
	}
	function parse(src, reviver, options) {
		let _reviver;
		typeof reviver == "function" ? _reviver = reviver : options === void 0 && reviver && typeof reviver == "object" && (options = reviver);
		let doc = parseDocument(src, options);
		if (!doc) return null;
		if (doc.warnings.forEach((warning) => log.warn(doc.options.logLevel, warning)), doc.errors.length > 0) {
			if (doc.options.logLevel !== "silent") throw doc.errors[0];
			doc.errors = [];
		}
		return doc.toJS(Object.assign({ reviver: _reviver }, options));
	}
	function stringify(value, replacer, options) {
		let _replacer = null;
		if (typeof replacer == "function" || Array.isArray(replacer) ? _replacer = replacer : options === void 0 && replacer && (options = replacer), typeof options == "string" && (options = options.length), typeof options == "number") {
			let indent = Math.round(options);
			options = indent < 1 ? void 0 : indent > 8 ? { indent: 8 } : { indent };
		}
		if (value === void 0) {
			let { keepUndefined } = options ?? replacer ?? {};
			if (!keepUndefined) return;
		}
		return identity.isDocument(value) && !_replacer ? value.toString(options) : new Document.Document(value, _replacer, options).toString(options);
	}
	exports.parse = parse, exports.parseAllDocuments = parseAllDocuments, exports.parseDocument = parseDocument, exports.stringify = stringify;
})), import_dist$3 = __commonJSMin(((exports) => {
	var composer = require_composer(), Document = require_Document(), Schema = require_Schema(), errors = require_errors(), Alias = require_Alias(), identity = require_identity(), Pair = require_Pair(), Scalar = require_Scalar(), YAMLMap = require_YAMLMap(), YAMLSeq = require_YAMLSeq();
	require_cst();
	var lexer = require_lexer(), lineCounter = require_line_counter(), parser = require_parser(), publicApi = require_public_api(), visit = require_visit();
	exports.Composer = composer.Composer, exports.Document = Document.Document, exports.Schema = Schema.Schema, exports.YAMLError = errors.YAMLError, exports.YAMLParseError = errors.YAMLParseError, exports.YAMLWarning = errors.YAMLWarning, exports.Alias = Alias.Alias, exports.isAlias = identity.isAlias, exports.isCollection = identity.isCollection, exports.isDocument = identity.isDocument, exports.isMap = identity.isMap, exports.isNode = identity.isNode, exports.isPair = identity.isPair, exports.isScalar = identity.isScalar, exports.isSeq = identity.isSeq, exports.Pair = Pair.Pair, exports.Scalar = Scalar.Scalar, exports.YAMLMap = YAMLMap.YAMLMap, exports.YAMLSeq = YAMLSeq.YAMLSeq, exports.Lexer = lexer.Lexer, exports.LineCounter = lineCounter.LineCounter, exports.Parser = parser.Parser, exports.parse = publicApi.parse, exports.parseAllDocuments = publicApi.parseAllDocuments, exports.parseDocument = publicApi.parseDocument, exports.stringify = publicApi.stringify, exports.visit = visit.visit, exports.visitAsync = visit.visitAsync;
}))(), ConfigFileError = class extends ActionError {};
function inputEnvName(name) {
	return `INPUT_${name.replace(/ /g, "_").toUpperCase()}`;
}
function refuseUntrustedEvent(env) {
	let event = env.GITHUB_EVENT_NAME, triggeredBy;
	if (event === "workflow_run") {
		try {
			let runEvent = JSON.parse((0, node_fs.readFileSync)(env.GITHUB_EVENT_PATH ?? "", "utf8")).workflow_run?.event;
			triggeredBy = typeof runEvent == "string" ? runEvent : void 0;
		} catch (e) {
			throw new ConfigFileError(`config_file cannot be used: the workflow_run event payload could not be read (${errorMessage(e)}).`, "CONFIG_FILE_UNTRUSTED_EVENT");
		}
		if (!triggeredBy?.startsWith("pull_request")) return;
	} else if (event !== "pull_request_target") return;
	throw new ConfigFileError(`config_file cannot be used on ${triggeredBy ? `workflow_run triggered by ${triggeredBy}` : event}: the workspace may hold a pull request's code, which could then rewrite its own rules. Set the inputs in the workflow instead.`, "CONFIG_FILE_UNTRUSTED_EVENT");
}
function isOutside(root, path) {
	let inside = (0, node_path.relative)(root, path);
	return inside === ".." || inside.startsWith(`..${node_path.sep}`);
}
function resolveConfigPath(path, env) {
	let pathError = (reason) => new ConfigFileError(`config_file ${JSON.stringify(path)} ${reason}`, "CONFIG_FILE_PATH");
	if ((0, node_path.isAbsolute)(path)) throw pathError("must be relative to the workspace.");
	let workspace = (0, node_path.resolve)(env.GITHUB_WORKSPACE || process.cwd()), full = (0, node_path.resolve)(workspace, path);
	if (isOutside(workspace, full)) throw pathError("leads outside the workspace.");
	let real;
	try {
		real = (0, node_fs.realpathSync)(full);
	} catch {
		throw pathError("was not found in the workspace. Check out the repository in an earlier step.");
	}
	if (isOutside((0, node_fs.realpathSync)(workspace), real)) throw pathError("leads outside the workspace.");
	return real;
}
function parseConfig(text, path, known) {
	let invalid = (reason) => new ConfigFileError(`Invalid config_file ${JSON.stringify(path)}: ${reason}`, "CONFIG_FILE_INVALID"), doc;
	try {
		doc = (0, import_dist$3.parse)(text);
	} catch (e) {
		throw invalid(errorMessage(e));
	}
	if (doc == null) return new Map();
	if (typeof doc != "object" || Array.isArray(doc)) throw invalid("the top level must be a mapping of input names to values.");
	let values = new Map();
	for (let [key, value] of Object.entries(doc)) {
		if (!known.includes(key)) throw invalid(`unknown key ${JSON.stringify(key)}. Allowed keys: ${known.join(", ")}.`);
		if (value == null) values.set(key, "");
		else if ([
			"string",
			"number",
			"boolean"
		].includes(typeof value)) values.set(key, String(value));
		else throw invalid(`${key} must be a string, as it would be in the workflow.`);
	}
	return values;
}
function applyConfigFile(env, { known, lists }) {
	let path = env[inputEnvName("config_file")]?.trim() ?? "";
	if (!path) return;
	refuseUntrustedEvent(env);
	let full = resolveConfigPath(path, env), text;
	try {
		text = (0, node_fs.readFileSync)(full, "utf8");
	} catch (e) {
		throw new ConfigFileError(`config_file ${JSON.stringify(path)} could not be read: ${errorMessage(e)}`, "CONFIG_FILE_PATH");
	}
	let values = parseConfig(text, path, known), summary = [`Inputs read from config_file ${path}:`];
	for (let [name, value] of values) {
		let envName = inputEnvName(name), inline = env[envName] ?? "";
		lists.includes(name) ? (env[envName] = [inline, value].filter((v) => v.trim()).join("\n"), summary.push(`  ${name}${inline.trim() ? " (added to the workflow's)" : ""}`)) : inline.trim() ? summary.push(`  ${name} (ignored: the workflow sets it)`) : (env[envName] = value, summary.push(`  ${name}`));
	}
	return {
		path: full,
		summary
	};
}
function capturedStderr(e) {
	let err = e && typeof e == "object" ? e : {};
	return typeof err.stderr == "string" ? err.stderr.trim() : "";
}
function describeDockerFailure(e, { operation = "docker", env = process.env, exists = node_fs.existsSync } = {}) {
	let err = e && typeof e == "object" ? e : {}, slimNote = isLikelySlimRunner(env, exists) ? " Detected a container-based GitHub-hosted runner image (e.g. \"ubuntu-slim\"): these ship a Docker client with no daemon and are not supported for this action." : "", whatHappened;
	if (err.code === "ENOENT") whatHappened = `The "docker" command was not found on this runner's PATH while running ${operation}.`;
	else {
		let captured = capturedStderr(e);
		whatHappened = `${operation} failed${captured ? `: ${captured}` : " (see the Docker output above for the underlying error)"}.`;
	}
	return `${whatHappened}${slimNote} Buildcage requires a working Docker installation (client and daemon) on the runner, on Docker Engine 25.0 or later with Compose v2.20.2 or later. Lightweight runner images such as GitHub-hosted "ubuntu-slim" ship a Docker client but no daemon and are not supported for this action. Use "ubuntu-latest", or another runner with a full Docker install, instead. See README.md and docs/security.md for details.`;
}
function isLikelySlimRunner(_env = process.env, _exists = node_fs.existsSync) {
	return _env.ImageOS === "Linux" && _exists("/run/.containerenv");
}
//#endregion
//#region src/core/lib/actions/inputs.ts
var InvalidInputError = class extends ActionError {};
function readBooleanInput(name, fallback, getInput) {
	let value = getInput(name);
	if (value === "") return fallback;
	if ([
		"true",
		"True",
		"TRUE"
	].includes(value)) return !0;
	if ([
		"false",
		"False",
		"FALSE"
	].includes(value)) return !1;
	throw new InvalidInputError(`Invalid ${name}: ${JSON.stringify(value)}. Must be true or false.`, "INVALID_BOOLEAN_INPUT");
}
const ENGINES = ["universal", "inspect"];
function resolveProxyEngine$1(input) {
	let trimmed = input?.trim() || "inspect";
	if (trimmed === "transparent") throw new InvalidInputError("proxy_engine: transparent has been renamed. Use proxy_engine: universal.", "INVALID_PROXY_ENGINE");
	if (!ENGINES.includes(trimmed)) throw new InvalidInputError(`Invalid proxy_engine: ${JSON.stringify(input)}. Must be one of ${ENGINES.join(", ")}.`, "INVALID_PROXY_ENGINE");
	return trimmed;
}
const PROXY_MODES = ["audit", "restrict"];
function resolveProxyMode(input) {
	let trimmed = input?.trim() || "restrict";
	if (!PROXY_MODES.includes(trimmed)) throw new InvalidInputError(`Invalid proxy_mode: ${JSON.stringify(input)}. Must be one of ${PROXY_MODES.join(", ")}.`, "INVALID_PROXY_MODE");
	return trimmed;
}
//#endregion
//#region src/core/lib/actions/engine-rule-support.ts
function checkUrlAndTlsRuleSupport({ proxyEngine, proxyMode, urlRules, tlsRules }, warn) {
	if (proxyEngine === "inspect") return;
	let unsupported = [];
	if (urlRules.length > 0 && unsupported.push("allowed_url_rules"), tlsRules.length > 0 && unsupported.push("allowed_tls_rules"), unsupported.length === 0) return;
	let list = unsupported.join(" and "), reason = `${list} ${unsupported.length > 1 ? "have" : "has"} no effect with proxy_engine: ${proxyEngine}, which only sees the host and port, never a method or a path.`;
	if (proxyMode === "audit") {
		warn(`${reason} They are ignored for this run. Switch to proxy_engine: inspect if you need to enforce a method or a path.`);
		return;
	}
	throw new InvalidInputError(`${reason} In restrict mode that means ${list} would not actually be enforced, so the step would look protected but isn't. Switch to proxy_engine: inspect, or remove ${list} from your workflow.`, "INVALID_PROXY_ENGINE");
}
function checkKnownBlockedUrlRuleSupport({ proxyEngine, proxyMode, knownBlockedUrlRules }, warn) {
	if (proxyEngine === "inspect" || knownBlockedUrlRules.length === 0) return;
	let reason = `known_blocked_rules contains URL rules (a method and a URL) that need proxy_engine: inspect, which alone sees a method or a path; proxy_engine: ${proxyEngine} sees only the host and port, so these rules match no blocked connection and acknowledge nothing.`;
	if (proxyMode === "audit") {
		warn(`${reason} They are ignored for this run. Drop the method to acknowledge the whole host, or switch to proxy_engine: inspect.`);
		return;
	}
	throw new InvalidInputError(`${reason} Drop the method to acknowledge the whole host, or switch to proxy_engine: inspect.`, "INVALID_PROXY_ENGINE");
}
//#endregion
//#region src/core/lib/actions/log.ts
function logRules(label, rules) {
	console.log(`${label} rules:${rules.length === 0 ? " (none)" : ""}`);
	for (let r of rules) console.log(`  ${r}`);
}
function withLogGroup(title, fn) {
	console.log(`::group::${title}`);
	try {
		return fn();
	} finally {
		console.log("::endgroup::");
	}
}
function buildComposeUpArgs({ composeFile, projectName, pullPolicy }) {
	return [
		"compose",
		"-f",
		composeFile,
		"-p",
		projectName,
		"up",
		"-d",
		"--pull",
		pullPolicy,
		"--no-build",
		"--wait",
		"--wait-timeout",
		"180",
		"--quiet-pull"
	];
}
function buildComposeLogsArgs({ composeFile, projectName, tail }) {
	return [
		"compose",
		"-f",
		composeFile,
		"-p",
		projectName,
		"logs",
		"--no-color",
		"--tail",
		String(tail)
	];
}
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
//#endregion
//#region src/core/lib/provenance/image-ref.ts
function resolveBuildcageImageRef({ imageDigest, actionRepository }) {
	return `${`ghcr.io/${actionRepository}`.toLowerCase()}@${imageDigest}`;
}
//#endregion
//#region src/core/lib/provenance/docker-credentials.ts
function readGhcrBasicAuth(_env = process.env, _readFileSync = node_fs.readFileSync) {
	try {
		let configDir = _env.DOCKER_CONFIG ?? node_path.default.join(node_os.default.homedir(), ".docker"), config = JSON.parse(_readFileSync(node_path.default.join(configDir, "config.json"), "utf8"));
		for (let [key, value] of Object.entries(config.auths ?? {})) if (key.replace(/^https?:\/\//, "").replace(/\/$/, "") === "ghcr.io" && typeof value.auth == "string" && value.auth) return value.auth;
		return null;
	} catch {
		return null;
	}
}
//#endregion
//#region src/core/lib/provenance/errors.ts
var VerifyImageError = class extends ActionError {}, ProvenanceError = class extends ActionError {};
function engineTagSuffix(proxyEngine) {
	return `-${proxyEngine}`;
}
function imageTagFromRef(actionRef, proxyEngine = "inspect") {
	if (!actionRef) return "";
	let base;
	return base = /^[0-9a-f]{40}$/i.test(actionRef) ? `sha-${actionRef.toLowerCase()}` : actionRef.startsWith("v") ? actionRef.slice(1) : actionRef, `${base}${engineTagSuffix(proxyEngine)}`;
}
//#endregion
//#region src/core/lib/provenance/engine-label.ts
const IMAGE_VERSION_LABEL = "org.opencontainers.image.version", RELEASE_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$/;
function checkImageEngine({ labels, proxyEngine, imageTag }) {
	let label = labels[IMAGE_VERSION_LABEL];
	if (!label) throw new VerifyImageError(`Image ${imageTag} carries no ${IMAGE_VERSION_LABEL} label, so the proxy engine it was published for cannot be confirmed.`, "VERIFY_FAILED");
	let suffix = engineTagSuffix(proxyEngine);
	if (!(label.endsWith(suffix) && RELEASE_VERSION.test(label.slice(0, label.length - suffix.length)))) throw new VerifyImageError(`Image ${imageTag} was not published for proxy engine ${proxyEngine} (${IMAGE_VERSION_LABEL}: ${label}), so the rules this run was given would not be enforced.`, "VERIFY_FAILED");
}
//#endregion
//#region src/core/lib/provenance/oci-registry.ts
const MANIFEST_MEDIA_TYPES = ["application/vnd.oci.image.manifest.v1+json", "application/vnd.docker.distribution.manifest.v2+json"], INDEX_MEDIA_TYPES = ["application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.list.v2+json"];
async function withRegistryErrors(what, fn) {
	try {
		return await fn();
	} catch (err) {
		throw err instanceof VerifyImageError ? err : new VerifyImageError(`Transient error ${what}: ${errorMessage(err)}`, "TRANSIENT");
	}
}
function assertRegistryOk(resp, subject, onFailure) {
	if (resp.status >= 500) throw new VerifyImageError(`Transient error fetching ${subject}: HTTP ${resp.status}`, "TRANSIENT");
	if (resp.status === 401 || resp.status === 403) throw new VerifyImageError(`Registry denied access to ${subject}: HTTP ${resp.status}. For private repositories, ensure the runner is authenticated to the registry.`, "TRANSIENT");
	if (!resp.ok) throw new VerifyImageError(`Failed to fetch ${subject}: HTTP ${resp.status}`, onFailure);
}
const CONTENT_DIGEST_ALGORITHMS = {
	sha256: {
		subtle: "SHA-256",
		hexLength: 64
	},
	sha384: {
		subtle: "SHA-384",
		hexLength: 96
	},
	sha512: {
		subtle: "SHA-512",
		hexLength: 128
	}
};
function isOciDigest(digest) {
	if (typeof digest != "string") return !1;
	let match = /^([a-z0-9]+):([0-9a-f]+)$/.exec(digest);
	return match !== null && CONTENT_DIGEST_ALGORITHMS[match[1]]?.hexLength === match[2].length;
}
function assertOciDigest(digest, where) {
	if (isOciDigest(digest)) return digest;
	throw new VerifyImageError(`Malformed digest in ${where}: ${JSON.stringify(digest)}`, "VERIFY_FAILED");
}
async function assertContentDigest(bytes, expected, what) {
	let [algorithm] = expected.split(":", 1), subtleName = CONTENT_DIGEST_ALGORITHMS[algorithm]?.subtle;
	if (!subtleName) throw new VerifyImageError(`Cannot verify ${what}: unsupported digest algorithm in ${expected}.`, "VERIFY_FAILED");
	let hash = await crypto.subtle.digest(subtleName, bytes), actual = `${algorithm}:` + Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
	if (actual !== expected) throw new VerifyImageError(`Content digest mismatch for ${what}: the registry served ${actual}, not the requested ${expected}.`, "VERIFY_FAILED");
}
function registryClient(registry, repo, token, _fetch) {
	let api = `https://${registry}/v2/${repo}`, authorization = `Bearer ${token}`, request = (path, init = {}) => _fetch(`${api}${path}`, {
		method: init.method,
		headers: init.accept ? {
			Authorization: authorization,
			Accept: init.accept
		} : { Authorization: authorization }
	});
	return {
		request,
		getJson: (path, what, opts = {}) => withRegistryErrors(`fetching ${what}`, async () => {
			let resp = await request(path, { accept: opts.accept });
			if (resp.status === 404 && opts.absentOn404 !== !1) throw new VerifyImageError(`Not found: ${what}`, "NOT_FOUND");
			if (assertRegistryOk(resp, what, opts.onFailure ?? "TRANSIENT"), opts.verifyDigest !== void 0) {
				let bytes = new Uint8Array(await resp.arrayBuffer());
				return await assertContentDigest(bytes, opts.verifyDigest, what), JSON.parse(new TextDecoder().decode(bytes));
			}
			return await resp.json();
		})
	};
}
async function fetchManifestDigest(registry, repo, tag, token, _fetch = fetch) {
	let client = registryClient(registry, repo, token, _fetch), image = `${registry}/${repo}:${tag}`;
	return withRegistryErrors(`fetching manifest digest for ${image}`, async () => {
		let resp = await client.request(`/manifests/${tag}`, {
			method: "HEAD",
			accept: INDEX_MEDIA_TYPES.join(", ")
		});
		if (resp.status === 404) throw new VerifyImageError(`Docker image not found: ${image}. Make sure the action ref corresponds to a published release.`, "NOT_FOUND");
		assertRegistryOk(resp, `manifest for ${image}`, "TRANSIENT");
		let digest = resp.headers.get("Docker-Content-Digest");
		if (!digest) throw new VerifyImageError(`No digest in manifest response for ${image}`, "TRANSIENT");
		return assertOciDigest(digest, `manifest response for ${image}`);
	});
}
async function fetchImageConfigLabels(registry, repo, digest, token, _fetch = fetch) {
	let client = registryClient(registry, repo, token, _fetch), image = `${registry}/${repo}@${digest}`, root = await client.getJson(`/manifests/${digest}`, `manifest for ${image}`, {
		accept: [...INDEX_MEDIA_TYPES, ...MANIFEST_MEDIA_TYPES].join(", "),
		verifyDigest: digest
	}), manifest = root;
	if (Array.isArray(root.manifests)) {
		let platform = root.manifests.find((m) => m.platform?.os && m.platform.os !== "unknown");
		if (!platform) throw new VerifyImageError(`No platform manifest in image index ${image}`, "NOT_FOUND");
		let platformDigest = assertOciDigest(platform.digest, `image index ${image}`);
		manifest = await client.getJson(`/manifests/${platformDigest}`, `platform manifest for ${image}`, {
			accept: MANIFEST_MEDIA_TYPES.join(", "),
			verifyDigest: platformDigest
		});
	}
	if (!manifest.config?.digest) throw new VerifyImageError(`No image config in manifest for ${image}`, "NOT_FOUND");
	let configDigest = assertOciDigest(manifest.config.digest, `manifest for ${image}`);
	return (await client.getJson(`/blobs/${configDigest}`, `image config for ${image}`, { verifyDigest: configDigest })).config?.Labels ?? {};
}
async function fetchRegistryToken(registry, repo, basicAuth, _fetch = fetch) {
	let url = `https://${registry}/token?scope=repository:${repo}:pull&service=${registry}`;
	return withRegistryErrors("fetching registry token", async () => {
		let resp = basicAuth ? await _fetch(url, { headers: { Authorization: `Basic ${basicAuth}` } }) : await _fetch(url);
		if (resp.status >= 500) throw new VerifyImageError(`Transient error from ${registry} token endpoint: HTTP ${resp.status}`, "TRANSIENT");
		if (resp.ok) return (await resp.json()).token;
		throw new VerifyImageError(basicAuth ? `Registry authentication failed: HTTP ${resp.status}. The credentials in Docker config may be expired, and ${registry} refuses them even for a public package. Run \`docker login ${registry}\` again, or \`docker logout ${registry}\` if the package is public.` : `Failed to get registry token: HTTP ${resp.status}. The package may be private. Run \`docker login ${registry}\` (or use docker/login-action with 'packages: read') before this action.`, "TOKEN_ERROR");
	});
}
//#endregion
//#region src/core/lib/provenance/oci-bundle.ts
const BUNDLE_MEDIA_TYPE = "application/vnd.dev.sigstore.bundle.v0.3+json", IMAGE_MANIFEST_MEDIA_TYPE = "application/vnd.oci.image.manifest.v1+json";
async function fetchBundle(registry, repo, digest, token, _fetch = fetch) {
	let client = registryClient(registry, repo, token, _fetch), fromReferrers = await bundleFromReferrers(client, digest);
	return fromReferrers ? fromReferrers.bundle : bundleFromFallbackTag(client, digest);
}
function noBundleFound(digest) {
	return new VerifyImageError(`No Sigstore bundle found for digest ${digest}. The image may not have been signed with --new-bundle-format.`, "NOT_FOUND");
}
async function bundleFromReferrers(client, digest) {
	return withRegistryErrors("fetching referrers", async () => {
		let resp = await client.request(`/referrers/${digest}?artifactType=application%2Fvnd.dev.sigstore.bundle.v0.3%2Bjson`);
		if (resp.status >= 500) throw new VerifyImageError(`Transient error from referrers API: HTTP ${resp.status}`, "TRANSIENT");
		if (!resp.ok) return;
		let manifest = ((await resp.json()).manifests ?? []).find((m) => m.artifactType === BUNDLE_MEDIA_TYPE);
		if (manifest) return { bundle: await bundleFromManifest(client, assertOciDigest(manifest.digest, "referrers response")) };
	});
}
async function bundleFromFallbackTag(client, digest) {
	return withRegistryErrors("fetching fallback tag", async () => {
		let resp = await client.request(`/manifests/${digest.replace(":", "-")}`, { accept: ["application/vnd.oci.image.index.v1+json", IMAGE_MANIFEST_MEDIA_TYPE].join(", ") });
		if (resp.status === 404 || resp.status === 400) throw noBundleFound(digest);
		assertRegistryOk(resp, "fallback tag", "NOT_FOUND");
		let tagManifest = await resp.json();
		if (Array.isArray(tagManifest.manifests)) {
			for (let m of tagManifest.manifests) {
				if (m.mediaType !== IMAGE_MANIFEST_MEDIA_TYPE || !isOciDigest(m.digest)) continue;
				if (m.artifactType === BUNDLE_MEDIA_TYPE) return bundleFromManifest(client, m.digest);
				let subResp = await client.request(`/manifests/${m.digest}`, { accept: IMAGE_MANIFEST_MEDIA_TYPE });
				if (!subResp.ok) continue;
				let sub = await subResp.json();
				if (sub.artifactType !== BUNDLE_MEDIA_TYPE) continue;
				let layer = (sub.layers ?? []).find((l) => l.mediaType === BUNDLE_MEDIA_TYPE);
				if (layer) return bundleBlob(client, layer.digest);
			}
			throw noBundleFound(digest);
		}
		let layer = (tagManifest.layers ?? []).find((l) => l.mediaType === BUNDLE_MEDIA_TYPE);
		if (!layer) throw noBundleFound(digest);
		return bundleBlob(client, layer.digest);
	});
}
async function bundleFromManifest(client, manifestDigest) {
	let layer = ((await client.getJson(`/manifests/${manifestDigest}`, "bundle manifest", {
		accept: IMAGE_MANIFEST_MEDIA_TYPE,
		absentOn404: !1
	})).layers ?? []).find((l) => l.mediaType === BUNDLE_MEDIA_TYPE);
	if (!layer) throw new VerifyImageError("No Sigstore bundle layer found in bundle manifest", "NOT_FOUND");
	return bundleBlob(client, layer.digest);
}
async function bundleBlob(client, blobDigest) {
	return client.getJson(`/blobs/${assertOciDigest(blobDigest, "bundle manifest")}`, "bundle blob", {
		onFailure: "NOT_FOUND",
		absentOn404: !1
	});
}
//#endregion
//#region node_modules/.pnpm/@sigstore+protobuf-specs@0.5.2/node_modules/@sigstore/protobuf-specs/dist/__generated__/envelope.js
var require_envelope = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Signature = exports.Envelope = void 0, exports.Envelope = {
		fromJSON(object) {
			return {
				payload: isSet(object.payload) ? Buffer.from(bytesFromBase64(object.payload)) : Buffer.alloc(0),
				payloadType: isSet(object.payloadType) ? globalThis.String(object.payloadType) : "",
				signatures: globalThis.Array.isArray(object?.signatures) ? object.signatures.map((e) => exports.Signature.fromJSON(e)) : []
			};
		},
		toJSON(message) {
			let obj = {};
			return message.payload.length !== 0 && (obj.payload = base64FromBytes(message.payload)), message.payloadType !== "" && (obj.payloadType = message.payloadType), message.signatures?.length && (obj.signatures = message.signatures.map((e) => exports.Signature.toJSON(e))), obj;
		}
	}, exports.Signature = {
		fromJSON(object) {
			return {
				sig: isSet(object.sig) ? Buffer.from(bytesFromBase64(object.sig)) : Buffer.alloc(0),
				keyid: isSet(object.keyid) ? globalThis.String(object.keyid) : ""
			};
		},
		toJSON(message) {
			let obj = {};
			return message.sig.length !== 0 && (obj.sig = base64FromBytes(message.sig)), message.keyid !== "" && (obj.keyid = message.keyid), obj;
		}
	};
	function bytesFromBase64(b64) {
		return Uint8Array.from(globalThis.Buffer.from(b64, "base64"));
	}
	function base64FromBytes(arr) {
		return globalThis.Buffer.from(arr).toString("base64");
	}
	function isSet(value) {
		return value != null;
	}
})), require_timestamp$3 = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Timestamp = void 0, exports.Timestamp = {
		fromJSON(object) {
			return {
				seconds: isSet(object.seconds) ? globalThis.String(object.seconds) : "0",
				nanos: isSet(object.nanos) ? globalThis.Number(object.nanos) : 0
			};
		},
		toJSON(message) {
			let obj = {};
			return message.seconds !== "0" && (obj.seconds = message.seconds), message.nanos !== 0 && (obj.nanos = Math.round(message.nanos)), obj;
		}
	};
	function isSet(value) {
		return value != null;
	}
})), require_sigstore_common = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.TimeRange = exports.X509CertificateChain = exports.SubjectAlternativeName = exports.X509Certificate = exports.DistinguishedName = exports.ObjectIdentifierValuePair = exports.ObjectIdentifier = exports.PublicKeyIdentifier = exports.PublicKey = exports.RFC3161SignedTimestamp = exports.LogId = exports.MessageSignature = exports.HashOutput = exports.SubjectAlternativeNameType = exports.PublicKeyDetails = exports.HashAlgorithm = void 0, exports.hashAlgorithmFromJSON = hashAlgorithmFromJSON, exports.hashAlgorithmToJSON = hashAlgorithmToJSON, exports.publicKeyDetailsFromJSON = publicKeyDetailsFromJSON, exports.publicKeyDetailsToJSON = publicKeyDetailsToJSON, exports.subjectAlternativeNameTypeFromJSON = subjectAlternativeNameTypeFromJSON, exports.subjectAlternativeNameTypeToJSON = subjectAlternativeNameTypeToJSON;
	let timestamp_1 = require_timestamp$3();
	var HashAlgorithm;
	(function(HashAlgorithm) {
		HashAlgorithm[HashAlgorithm.HASH_ALGORITHM_UNSPECIFIED = 0] = "HASH_ALGORITHM_UNSPECIFIED", HashAlgorithm[HashAlgorithm.SHA2_256 = 1] = "SHA2_256", HashAlgorithm[HashAlgorithm.SHA2_384 = 2] = "SHA2_384", HashAlgorithm[HashAlgorithm.SHA2_512 = 3] = "SHA2_512", HashAlgorithm[HashAlgorithm.SHA3_256 = 4] = "SHA3_256", HashAlgorithm[HashAlgorithm.SHA3_384 = 5] = "SHA3_384";
	})(HashAlgorithm || (exports.HashAlgorithm = HashAlgorithm = {}));
	function hashAlgorithmFromJSON(object) {
		switch (object) {
			case 0:
			case "HASH_ALGORITHM_UNSPECIFIED": return HashAlgorithm.HASH_ALGORITHM_UNSPECIFIED;
			case 1:
			case "SHA2_256": return HashAlgorithm.SHA2_256;
			case 2:
			case "SHA2_384": return HashAlgorithm.SHA2_384;
			case 3:
			case "SHA2_512": return HashAlgorithm.SHA2_512;
			case 4:
			case "SHA3_256": return HashAlgorithm.SHA3_256;
			case 5:
			case "SHA3_384": return HashAlgorithm.SHA3_384;
			default: throw new globalThis.Error("Unrecognized enum value " + object + " for enum HashAlgorithm");
		}
	}
	function hashAlgorithmToJSON(object) {
		switch (object) {
			case HashAlgorithm.HASH_ALGORITHM_UNSPECIFIED: return "HASH_ALGORITHM_UNSPECIFIED";
			case HashAlgorithm.SHA2_256: return "SHA2_256";
			case HashAlgorithm.SHA2_384: return "SHA2_384";
			case HashAlgorithm.SHA2_512: return "SHA2_512";
			case HashAlgorithm.SHA3_256: return "SHA3_256";
			case HashAlgorithm.SHA3_384: return "SHA3_384";
			default: throw new globalThis.Error("Unrecognized enum value " + object + " for enum HashAlgorithm");
		}
	}
	var PublicKeyDetails;
	(function(PublicKeyDetails) {
		PublicKeyDetails[PublicKeyDetails.PUBLIC_KEY_DETAILS_UNSPECIFIED = 0] = "PUBLIC_KEY_DETAILS_UNSPECIFIED", PublicKeyDetails[PublicKeyDetails.PKCS1_RSA_PKCS1V5 = 1] = "PKCS1_RSA_PKCS1V5", PublicKeyDetails[PublicKeyDetails.PKCS1_RSA_PSS = 2] = "PKCS1_RSA_PSS", PublicKeyDetails[PublicKeyDetails.PKIX_RSA_PKCS1V5 = 3] = "PKIX_RSA_PKCS1V5", PublicKeyDetails[PublicKeyDetails.PKIX_RSA_PSS = 4] = "PKIX_RSA_PSS", PublicKeyDetails[PublicKeyDetails.PKIX_RSA_PKCS1V15_2048_SHA256 = 9] = "PKIX_RSA_PKCS1V15_2048_SHA256", PublicKeyDetails[PublicKeyDetails.PKIX_RSA_PKCS1V15_3072_SHA256 = 10] = "PKIX_RSA_PKCS1V15_3072_SHA256", PublicKeyDetails[PublicKeyDetails.PKIX_RSA_PKCS1V15_4096_SHA256 = 11] = "PKIX_RSA_PKCS1V15_4096_SHA256", PublicKeyDetails[PublicKeyDetails.PKIX_RSA_PSS_2048_SHA256 = 16] = "PKIX_RSA_PSS_2048_SHA256", PublicKeyDetails[PublicKeyDetails.PKIX_RSA_PSS_3072_SHA256 = 17] = "PKIX_RSA_PSS_3072_SHA256", PublicKeyDetails[PublicKeyDetails.PKIX_RSA_PSS_4096_SHA256 = 18] = "PKIX_RSA_PSS_4096_SHA256", PublicKeyDetails[PublicKeyDetails.PKIX_ECDSA_P256_HMAC_SHA_256 = 6] = "PKIX_ECDSA_P256_HMAC_SHA_256", PublicKeyDetails[PublicKeyDetails.PKIX_ECDSA_P256_SHA_256 = 5] = "PKIX_ECDSA_P256_SHA_256", PublicKeyDetails[PublicKeyDetails.PKIX_ECDSA_P384_SHA_384 = 12] = "PKIX_ECDSA_P384_SHA_384", PublicKeyDetails[PublicKeyDetails.PKIX_ECDSA_P521_SHA_512 = 13] = "PKIX_ECDSA_P521_SHA_512", PublicKeyDetails[PublicKeyDetails.PKIX_ED25519 = 7] = "PKIX_ED25519", PublicKeyDetails[PublicKeyDetails.PKIX_ED25519_PH = 8] = "PKIX_ED25519_PH", PublicKeyDetails[PublicKeyDetails.PKIX_ECDSA_P384_SHA_256 = 19] = "PKIX_ECDSA_P384_SHA_256", PublicKeyDetails[PublicKeyDetails.PKIX_ECDSA_P521_SHA_256 = 20] = "PKIX_ECDSA_P521_SHA_256", PublicKeyDetails[PublicKeyDetails.LMS_SHA256 = 14] = "LMS_SHA256", PublicKeyDetails[PublicKeyDetails.LMOTS_SHA256 = 15] = "LMOTS_SHA256", PublicKeyDetails[PublicKeyDetails.ML_DSA_44 = 23] = "ML_DSA_44", PublicKeyDetails[PublicKeyDetails.ML_DSA_65 = 21] = "ML_DSA_65", PublicKeyDetails[PublicKeyDetails.ML_DSA_87 = 22] = "ML_DSA_87";
	})(PublicKeyDetails || (exports.PublicKeyDetails = PublicKeyDetails = {}));
	function publicKeyDetailsFromJSON(object) {
		switch (object) {
			case 0:
			case "PUBLIC_KEY_DETAILS_UNSPECIFIED": return PublicKeyDetails.PUBLIC_KEY_DETAILS_UNSPECIFIED;
			case 1:
			case "PKCS1_RSA_PKCS1V5": return PublicKeyDetails.PKCS1_RSA_PKCS1V5;
			case 2:
			case "PKCS1_RSA_PSS": return PublicKeyDetails.PKCS1_RSA_PSS;
			case 3:
			case "PKIX_RSA_PKCS1V5": return PublicKeyDetails.PKIX_RSA_PKCS1V5;
			case 4:
			case "PKIX_RSA_PSS": return PublicKeyDetails.PKIX_RSA_PSS;
			case 9:
			case "PKIX_RSA_PKCS1V15_2048_SHA256": return PublicKeyDetails.PKIX_RSA_PKCS1V15_2048_SHA256;
			case 10:
			case "PKIX_RSA_PKCS1V15_3072_SHA256": return PublicKeyDetails.PKIX_RSA_PKCS1V15_3072_SHA256;
			case 11:
			case "PKIX_RSA_PKCS1V15_4096_SHA256": return PublicKeyDetails.PKIX_RSA_PKCS1V15_4096_SHA256;
			case 16:
			case "PKIX_RSA_PSS_2048_SHA256": return PublicKeyDetails.PKIX_RSA_PSS_2048_SHA256;
			case 17:
			case "PKIX_RSA_PSS_3072_SHA256": return PublicKeyDetails.PKIX_RSA_PSS_3072_SHA256;
			case 18:
			case "PKIX_RSA_PSS_4096_SHA256": return PublicKeyDetails.PKIX_RSA_PSS_4096_SHA256;
			case 6:
			case "PKIX_ECDSA_P256_HMAC_SHA_256": return PublicKeyDetails.PKIX_ECDSA_P256_HMAC_SHA_256;
			case 5:
			case "PKIX_ECDSA_P256_SHA_256": return PublicKeyDetails.PKIX_ECDSA_P256_SHA_256;
			case 12:
			case "PKIX_ECDSA_P384_SHA_384": return PublicKeyDetails.PKIX_ECDSA_P384_SHA_384;
			case 13:
			case "PKIX_ECDSA_P521_SHA_512": return PublicKeyDetails.PKIX_ECDSA_P521_SHA_512;
			case 7:
			case "PKIX_ED25519": return PublicKeyDetails.PKIX_ED25519;
			case 8:
			case "PKIX_ED25519_PH": return PublicKeyDetails.PKIX_ED25519_PH;
			case 19:
			case "PKIX_ECDSA_P384_SHA_256": return PublicKeyDetails.PKIX_ECDSA_P384_SHA_256;
			case 20:
			case "PKIX_ECDSA_P521_SHA_256": return PublicKeyDetails.PKIX_ECDSA_P521_SHA_256;
			case 14:
			case "LMS_SHA256": return PublicKeyDetails.LMS_SHA256;
			case 15:
			case "LMOTS_SHA256": return PublicKeyDetails.LMOTS_SHA256;
			case 23:
			case "ML_DSA_44": return PublicKeyDetails.ML_DSA_44;
			case 21:
			case "ML_DSA_65": return PublicKeyDetails.ML_DSA_65;
			case 22:
			case "ML_DSA_87": return PublicKeyDetails.ML_DSA_87;
			default: throw new globalThis.Error("Unrecognized enum value " + object + " for enum PublicKeyDetails");
		}
	}
	function publicKeyDetailsToJSON(object) {
		switch (object) {
			case PublicKeyDetails.PUBLIC_KEY_DETAILS_UNSPECIFIED: return "PUBLIC_KEY_DETAILS_UNSPECIFIED";
			case PublicKeyDetails.PKCS1_RSA_PKCS1V5: return "PKCS1_RSA_PKCS1V5";
			case PublicKeyDetails.PKCS1_RSA_PSS: return "PKCS1_RSA_PSS";
			case PublicKeyDetails.PKIX_RSA_PKCS1V5: return "PKIX_RSA_PKCS1V5";
			case PublicKeyDetails.PKIX_RSA_PSS: return "PKIX_RSA_PSS";
			case PublicKeyDetails.PKIX_RSA_PKCS1V15_2048_SHA256: return "PKIX_RSA_PKCS1V15_2048_SHA256";
			case PublicKeyDetails.PKIX_RSA_PKCS1V15_3072_SHA256: return "PKIX_RSA_PKCS1V15_3072_SHA256";
			case PublicKeyDetails.PKIX_RSA_PKCS1V15_4096_SHA256: return "PKIX_RSA_PKCS1V15_4096_SHA256";
			case PublicKeyDetails.PKIX_RSA_PSS_2048_SHA256: return "PKIX_RSA_PSS_2048_SHA256";
			case PublicKeyDetails.PKIX_RSA_PSS_3072_SHA256: return "PKIX_RSA_PSS_3072_SHA256";
			case PublicKeyDetails.PKIX_RSA_PSS_4096_SHA256: return "PKIX_RSA_PSS_4096_SHA256";
			case PublicKeyDetails.PKIX_ECDSA_P256_HMAC_SHA_256: return "PKIX_ECDSA_P256_HMAC_SHA_256";
			case PublicKeyDetails.PKIX_ECDSA_P256_SHA_256: return "PKIX_ECDSA_P256_SHA_256";
			case PublicKeyDetails.PKIX_ECDSA_P384_SHA_384: return "PKIX_ECDSA_P384_SHA_384";
			case PublicKeyDetails.PKIX_ECDSA_P521_SHA_512: return "PKIX_ECDSA_P521_SHA_512";
			case PublicKeyDetails.PKIX_ED25519: return "PKIX_ED25519";
			case PublicKeyDetails.PKIX_ED25519_PH: return "PKIX_ED25519_PH";
			case PublicKeyDetails.PKIX_ECDSA_P384_SHA_256: return "PKIX_ECDSA_P384_SHA_256";
			case PublicKeyDetails.PKIX_ECDSA_P521_SHA_256: return "PKIX_ECDSA_P521_SHA_256";
			case PublicKeyDetails.LMS_SHA256: return "LMS_SHA256";
			case PublicKeyDetails.LMOTS_SHA256: return "LMOTS_SHA256";
			case PublicKeyDetails.ML_DSA_44: return "ML_DSA_44";
			case PublicKeyDetails.ML_DSA_65: return "ML_DSA_65";
			case PublicKeyDetails.ML_DSA_87: return "ML_DSA_87";
			default: throw new globalThis.Error("Unrecognized enum value " + object + " for enum PublicKeyDetails");
		}
	}
	var SubjectAlternativeNameType;
	(function(SubjectAlternativeNameType) {
		SubjectAlternativeNameType[SubjectAlternativeNameType.SUBJECT_ALTERNATIVE_NAME_TYPE_UNSPECIFIED = 0] = "SUBJECT_ALTERNATIVE_NAME_TYPE_UNSPECIFIED", SubjectAlternativeNameType[SubjectAlternativeNameType.EMAIL = 1] = "EMAIL", SubjectAlternativeNameType[SubjectAlternativeNameType.URI = 2] = "URI", SubjectAlternativeNameType[SubjectAlternativeNameType.OTHER_NAME = 3] = "OTHER_NAME";
	})(SubjectAlternativeNameType || (exports.SubjectAlternativeNameType = SubjectAlternativeNameType = {}));
	function subjectAlternativeNameTypeFromJSON(object) {
		switch (object) {
			case 0:
			case "SUBJECT_ALTERNATIVE_NAME_TYPE_UNSPECIFIED": return SubjectAlternativeNameType.SUBJECT_ALTERNATIVE_NAME_TYPE_UNSPECIFIED;
			case 1:
			case "EMAIL": return SubjectAlternativeNameType.EMAIL;
			case 2:
			case "URI": return SubjectAlternativeNameType.URI;
			case 3:
			case "OTHER_NAME": return SubjectAlternativeNameType.OTHER_NAME;
			default: throw new globalThis.Error("Unrecognized enum value " + object + " for enum SubjectAlternativeNameType");
		}
	}
	function subjectAlternativeNameTypeToJSON(object) {
		switch (object) {
			case SubjectAlternativeNameType.SUBJECT_ALTERNATIVE_NAME_TYPE_UNSPECIFIED: return "SUBJECT_ALTERNATIVE_NAME_TYPE_UNSPECIFIED";
			case SubjectAlternativeNameType.EMAIL: return "EMAIL";
			case SubjectAlternativeNameType.URI: return "URI";
			case SubjectAlternativeNameType.OTHER_NAME: return "OTHER_NAME";
			default: throw new globalThis.Error("Unrecognized enum value " + object + " for enum SubjectAlternativeNameType");
		}
	}
	exports.HashOutput = {
		fromJSON(object) {
			return {
				algorithm: isSet(object.algorithm) ? hashAlgorithmFromJSON(object.algorithm) : 0,
				digest: isSet(object.digest) ? Buffer.from(bytesFromBase64(object.digest)) : Buffer.alloc(0)
			};
		},
		toJSON(message) {
			let obj = {};
			return message.algorithm !== 0 && (obj.algorithm = hashAlgorithmToJSON(message.algorithm)), message.digest.length !== 0 && (obj.digest = base64FromBytes(message.digest)), obj;
		}
	}, exports.MessageSignature = {
		fromJSON(object) {
			return {
				messageDigest: isSet(object.messageDigest) ? exports.HashOutput.fromJSON(object.messageDigest) : void 0,
				signature: isSet(object.signature) ? Buffer.from(bytesFromBase64(object.signature)) : Buffer.alloc(0)
			};
		},
		toJSON(message) {
			let obj = {};
			return message.messageDigest !== void 0 && (obj.messageDigest = exports.HashOutput.toJSON(message.messageDigest)), message.signature.length !== 0 && (obj.signature = base64FromBytes(message.signature)), obj;
		}
	}, exports.LogId = {
		fromJSON(object) {
			return { keyId: isSet(object.keyId) ? Buffer.from(bytesFromBase64(object.keyId)) : Buffer.alloc(0) };
		},
		toJSON(message) {
			let obj = {};
			return message.keyId.length !== 0 && (obj.keyId = base64FromBytes(message.keyId)), obj;
		}
	}, exports.RFC3161SignedTimestamp = {
		fromJSON(object) {
			return { signedTimestamp: isSet(object.signedTimestamp) ? Buffer.from(bytesFromBase64(object.signedTimestamp)) : Buffer.alloc(0) };
		},
		toJSON(message) {
			let obj = {};
			return message.signedTimestamp.length !== 0 && (obj.signedTimestamp = base64FromBytes(message.signedTimestamp)), obj;
		}
	}, exports.PublicKey = {
		fromJSON(object) {
			return {
				rawBytes: isSet(object.rawBytes) ? Buffer.from(bytesFromBase64(object.rawBytes)) : void 0,
				keyDetails: isSet(object.keyDetails) ? publicKeyDetailsFromJSON(object.keyDetails) : 0,
				validFor: isSet(object.validFor) ? exports.TimeRange.fromJSON(object.validFor) : void 0
			};
		},
		toJSON(message) {
			let obj = {};
			return message.rawBytes !== void 0 && (obj.rawBytes = base64FromBytes(message.rawBytes)), message.keyDetails !== 0 && (obj.keyDetails = publicKeyDetailsToJSON(message.keyDetails)), message.validFor !== void 0 && (obj.validFor = exports.TimeRange.toJSON(message.validFor)), obj;
		}
	}, exports.PublicKeyIdentifier = {
		fromJSON(object) {
			return { hint: isSet(object.hint) ? globalThis.String(object.hint) : "" };
		},
		toJSON(message) {
			let obj = {};
			return message.hint !== "" && (obj.hint = message.hint), obj;
		}
	}, exports.ObjectIdentifier = {
		fromJSON(object) {
			return { id: globalThis.Array.isArray(object?.id) ? object.id.map((e) => globalThis.Number(e)) : [] };
		},
		toJSON(message) {
			let obj = {};
			return message.id?.length && (obj.id = message.id.map((e) => Math.round(e))), obj;
		}
	}, exports.ObjectIdentifierValuePair = {
		fromJSON(object) {
			return {
				oid: isSet(object.oid) ? exports.ObjectIdentifier.fromJSON(object.oid) : void 0,
				value: isSet(object.value) ? Buffer.from(bytesFromBase64(object.value)) : Buffer.alloc(0)
			};
		},
		toJSON(message) {
			let obj = {};
			return message.oid !== void 0 && (obj.oid = exports.ObjectIdentifier.toJSON(message.oid)), message.value.length !== 0 && (obj.value = base64FromBytes(message.value)), obj;
		}
	}, exports.DistinguishedName = {
		fromJSON(object) {
			return {
				organization: isSet(object.organization) ? globalThis.String(object.organization) : "",
				commonName: isSet(object.commonName) ? globalThis.String(object.commonName) : ""
			};
		},
		toJSON(message) {
			let obj = {};
			return message.organization !== "" && (obj.organization = message.organization), message.commonName !== "" && (obj.commonName = message.commonName), obj;
		}
	}, exports.X509Certificate = {
		fromJSON(object) {
			return { rawBytes: isSet(object.rawBytes) ? Buffer.from(bytesFromBase64(object.rawBytes)) : Buffer.alloc(0) };
		},
		toJSON(message) {
			let obj = {};
			return message.rawBytes.length !== 0 && (obj.rawBytes = base64FromBytes(message.rawBytes)), obj;
		}
	}, exports.SubjectAlternativeName = {
		fromJSON(object) {
			return {
				type: isSet(object.type) ? subjectAlternativeNameTypeFromJSON(object.type) : 0,
				identity: isSet(object.regexp) ? {
					$case: "regexp",
					regexp: globalThis.String(object.regexp)
				} : isSet(object.value) ? {
					$case: "value",
					value: globalThis.String(object.value)
				} : void 0
			};
		},
		toJSON(message) {
			let obj = {};
			return message.type !== 0 && (obj.type = subjectAlternativeNameTypeToJSON(message.type)), message.identity?.$case === "regexp" ? obj.regexp = message.identity.regexp : message.identity?.$case === "value" && (obj.value = message.identity.value), obj;
		}
	}, exports.X509CertificateChain = {
		fromJSON(object) {
			return { certificates: globalThis.Array.isArray(object?.certificates) ? object.certificates.map((e) => exports.X509Certificate.fromJSON(e)) : [] };
		},
		toJSON(message) {
			let obj = {};
			return message.certificates?.length && (obj.certificates = message.certificates.map((e) => exports.X509Certificate.toJSON(e))), obj;
		}
	}, exports.TimeRange = {
		fromJSON(object) {
			return {
				start: isSet(object.start) ? fromJsonTimestamp(object.start) : void 0,
				end: isSet(object.end) ? fromJsonTimestamp(object.end) : void 0
			};
		},
		toJSON(message) {
			let obj = {};
			return message.start !== void 0 && (obj.start = message.start.toISOString()), message.end !== void 0 && (obj.end = message.end.toISOString()), obj;
		}
	};
	function bytesFromBase64(b64) {
		return Uint8Array.from(globalThis.Buffer.from(b64, "base64"));
	}
	function base64FromBytes(arr) {
		return globalThis.Buffer.from(arr).toString("base64");
	}
	function fromTimestamp(t) {
		let millis = (globalThis.Number(t.seconds) || 0) * 1e3;
		return millis += (t.nanos || 0) / 1e6, new globalThis.Date(millis);
	}
	function fromJsonTimestamp(o) {
		return o instanceof globalThis.Date ? o : typeof o == "string" ? new globalThis.Date(o) : fromTimestamp(timestamp_1.Timestamp.fromJSON(o));
	}
	function isSet(value) {
		return value != null;
	}
})), require_sigstore_rekor = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.TransparencyLogEntry = exports.InclusionPromise = exports.InclusionProof = exports.Checkpoint = exports.KindVersion = void 0;
	let sigstore_common_1 = require_sigstore_common();
	exports.KindVersion = {
		fromJSON(object) {
			return {
				kind: isSet(object.kind) ? globalThis.String(object.kind) : "",
				version: isSet(object.version) ? globalThis.String(object.version) : ""
			};
		},
		toJSON(message) {
			let obj = {};
			return message.kind !== "" && (obj.kind = message.kind), message.version !== "" && (obj.version = message.version), obj;
		}
	}, exports.Checkpoint = {
		fromJSON(object) {
			return { envelope: isSet(object.envelope) ? globalThis.String(object.envelope) : "" };
		},
		toJSON(message) {
			let obj = {};
			return message.envelope !== "" && (obj.envelope = message.envelope), obj;
		}
	}, exports.InclusionProof = {
		fromJSON(object) {
			return {
				logIndex: isSet(object.logIndex) ? globalThis.String(object.logIndex) : "0",
				rootHash: isSet(object.rootHash) ? Buffer.from(bytesFromBase64(object.rootHash)) : Buffer.alloc(0),
				treeSize: isSet(object.treeSize) ? globalThis.String(object.treeSize) : "0",
				hashes: globalThis.Array.isArray(object?.hashes) ? object.hashes.map((e) => Buffer.from(bytesFromBase64(e))) : [],
				checkpoint: isSet(object.checkpoint) ? exports.Checkpoint.fromJSON(object.checkpoint) : void 0
			};
		},
		toJSON(message) {
			let obj = {};
			return message.logIndex !== "0" && (obj.logIndex = message.logIndex), message.rootHash.length !== 0 && (obj.rootHash = base64FromBytes(message.rootHash)), message.treeSize !== "0" && (obj.treeSize = message.treeSize), message.hashes?.length && (obj.hashes = message.hashes.map((e) => base64FromBytes(e))), message.checkpoint !== void 0 && (obj.checkpoint = exports.Checkpoint.toJSON(message.checkpoint)), obj;
		}
	}, exports.InclusionPromise = {
		fromJSON(object) {
			return { signedEntryTimestamp: isSet(object.signedEntryTimestamp) ? Buffer.from(bytesFromBase64(object.signedEntryTimestamp)) : Buffer.alloc(0) };
		},
		toJSON(message) {
			let obj = {};
			return message.signedEntryTimestamp.length !== 0 && (obj.signedEntryTimestamp = base64FromBytes(message.signedEntryTimestamp)), obj;
		}
	}, exports.TransparencyLogEntry = {
		fromJSON(object) {
			return {
				logIndex: isSet(object.logIndex) ? globalThis.String(object.logIndex) : "0",
				logId: isSet(object.logId) ? sigstore_common_1.LogId.fromJSON(object.logId) : void 0,
				kindVersion: isSet(object.kindVersion) ? exports.KindVersion.fromJSON(object.kindVersion) : void 0,
				integratedTime: isSet(object.integratedTime) ? globalThis.String(object.integratedTime) : "0",
				inclusionPromise: isSet(object.inclusionPromise) ? exports.InclusionPromise.fromJSON(object.inclusionPromise) : void 0,
				inclusionProof: isSet(object.inclusionProof) ? exports.InclusionProof.fromJSON(object.inclusionProof) : void 0,
				canonicalizedBody: isSet(object.canonicalizedBody) ? Buffer.from(bytesFromBase64(object.canonicalizedBody)) : Buffer.alloc(0)
			};
		},
		toJSON(message) {
			let obj = {};
			return message.logIndex !== "0" && (obj.logIndex = message.logIndex), message.logId !== void 0 && (obj.logId = sigstore_common_1.LogId.toJSON(message.logId)), message.kindVersion !== void 0 && (obj.kindVersion = exports.KindVersion.toJSON(message.kindVersion)), message.integratedTime !== "0" && (obj.integratedTime = message.integratedTime), message.inclusionPromise !== void 0 && (obj.inclusionPromise = exports.InclusionPromise.toJSON(message.inclusionPromise)), message.inclusionProof !== void 0 && (obj.inclusionProof = exports.InclusionProof.toJSON(message.inclusionProof)), message.canonicalizedBody.length !== 0 && (obj.canonicalizedBody = base64FromBytes(message.canonicalizedBody)), obj;
		}
	};
	function bytesFromBase64(b64) {
		return Uint8Array.from(globalThis.Buffer.from(b64, "base64"));
	}
	function base64FromBytes(arr) {
		return globalThis.Buffer.from(arr).toString("base64");
	}
	function isSet(value) {
		return value != null;
	}
})), require_sigstore_bundle = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Bundle = exports.VerificationMaterial = exports.TimestampVerificationData = void 0;
	let envelope_1 = require_envelope(), sigstore_common_1 = require_sigstore_common(), sigstore_rekor_1 = require_sigstore_rekor();
	exports.TimestampVerificationData = {
		fromJSON(object) {
			return { rfc3161Timestamps: globalThis.Array.isArray(object?.rfc3161Timestamps) ? object.rfc3161Timestamps.map((e) => sigstore_common_1.RFC3161SignedTimestamp.fromJSON(e)) : [] };
		},
		toJSON(message) {
			let obj = {};
			return message.rfc3161Timestamps?.length && (obj.rfc3161Timestamps = message.rfc3161Timestamps.map((e) => sigstore_common_1.RFC3161SignedTimestamp.toJSON(e))), obj;
		}
	}, exports.VerificationMaterial = {
		fromJSON(object) {
			return {
				content: isSet(object.publicKey) ? {
					$case: "publicKey",
					publicKey: sigstore_common_1.PublicKeyIdentifier.fromJSON(object.publicKey)
				} : isSet(object.x509CertificateChain) ? {
					$case: "x509CertificateChain",
					x509CertificateChain: sigstore_common_1.X509CertificateChain.fromJSON(object.x509CertificateChain)
				} : isSet(object.certificate) ? {
					$case: "certificate",
					certificate: sigstore_common_1.X509Certificate.fromJSON(object.certificate)
				} : void 0,
				tlogEntries: globalThis.Array.isArray(object?.tlogEntries) ? object.tlogEntries.map((e) => sigstore_rekor_1.TransparencyLogEntry.fromJSON(e)) : [],
				timestampVerificationData: isSet(object.timestampVerificationData) ? exports.TimestampVerificationData.fromJSON(object.timestampVerificationData) : void 0
			};
		},
		toJSON(message) {
			let obj = {};
			return message.content?.$case === "publicKey" ? obj.publicKey = sigstore_common_1.PublicKeyIdentifier.toJSON(message.content.publicKey) : message.content?.$case === "x509CertificateChain" ? obj.x509CertificateChain = sigstore_common_1.X509CertificateChain.toJSON(message.content.x509CertificateChain) : message.content?.$case === "certificate" && (obj.certificate = sigstore_common_1.X509Certificate.toJSON(message.content.certificate)), message.tlogEntries?.length && (obj.tlogEntries = message.tlogEntries.map((e) => sigstore_rekor_1.TransparencyLogEntry.toJSON(e))), message.timestampVerificationData !== void 0 && (obj.timestampVerificationData = exports.TimestampVerificationData.toJSON(message.timestampVerificationData)), obj;
		}
	}, exports.Bundle = {
		fromJSON(object) {
			return {
				mediaType: isSet(object.mediaType) ? globalThis.String(object.mediaType) : "",
				verificationMaterial: isSet(object.verificationMaterial) ? exports.VerificationMaterial.fromJSON(object.verificationMaterial) : void 0,
				content: isSet(object.messageSignature) ? {
					$case: "messageSignature",
					messageSignature: sigstore_common_1.MessageSignature.fromJSON(object.messageSignature)
				} : isSet(object.dsseEnvelope) ? {
					$case: "dsseEnvelope",
					dsseEnvelope: envelope_1.Envelope.fromJSON(object.dsseEnvelope)
				} : void 0
			};
		},
		toJSON(message) {
			let obj = {};
			return message.mediaType !== "" && (obj.mediaType = message.mediaType), message.verificationMaterial !== void 0 && (obj.verificationMaterial = exports.VerificationMaterial.toJSON(message.verificationMaterial)), message.content?.$case === "messageSignature" ? obj.messageSignature = sigstore_common_1.MessageSignature.toJSON(message.content.messageSignature) : message.content?.$case === "dsseEnvelope" && (obj.dsseEnvelope = envelope_1.Envelope.toJSON(message.content.dsseEnvelope)), obj;
		}
	};
	function isSet(value) {
		return value != null;
	}
})), require_sigstore_trustroot = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.ClientTrustConfig = exports.ServiceConfiguration = exports.Service = exports.SigningConfig = exports.TrustedRoot = exports.CertificateAuthority = exports.TransparencyLogInstance = exports.ServiceSelector = void 0, exports.serviceSelectorFromJSON = serviceSelectorFromJSON, exports.serviceSelectorToJSON = serviceSelectorToJSON;
	let sigstore_common_1 = require_sigstore_common();
	var ServiceSelector;
	(function(ServiceSelector) {
		ServiceSelector[ServiceSelector.SERVICE_SELECTOR_UNDEFINED = 0] = "SERVICE_SELECTOR_UNDEFINED", ServiceSelector[ServiceSelector.ALL = 1] = "ALL", ServiceSelector[ServiceSelector.ANY = 2] = "ANY", ServiceSelector[ServiceSelector.EXACT = 3] = "EXACT";
	})(ServiceSelector || (exports.ServiceSelector = ServiceSelector = {}));
	function serviceSelectorFromJSON(object) {
		switch (object) {
			case 0:
			case "SERVICE_SELECTOR_UNDEFINED": return ServiceSelector.SERVICE_SELECTOR_UNDEFINED;
			case 1:
			case "ALL": return ServiceSelector.ALL;
			case 2:
			case "ANY": return ServiceSelector.ANY;
			case 3:
			case "EXACT": return ServiceSelector.EXACT;
			default: throw new globalThis.Error("Unrecognized enum value " + object + " for enum ServiceSelector");
		}
	}
	function serviceSelectorToJSON(object) {
		switch (object) {
			case ServiceSelector.SERVICE_SELECTOR_UNDEFINED: return "SERVICE_SELECTOR_UNDEFINED";
			case ServiceSelector.ALL: return "ALL";
			case ServiceSelector.ANY: return "ANY";
			case ServiceSelector.EXACT: return "EXACT";
			default: throw new globalThis.Error("Unrecognized enum value " + object + " for enum ServiceSelector");
		}
	}
	exports.TransparencyLogInstance = {
		fromJSON(object) {
			return {
				baseUrl: isSet(object.baseUrl) ? globalThis.String(object.baseUrl) : "",
				hashAlgorithm: isSet(object.hashAlgorithm) ? (0, sigstore_common_1.hashAlgorithmFromJSON)(object.hashAlgorithm) : 0,
				publicKey: isSet(object.publicKey) ? sigstore_common_1.PublicKey.fromJSON(object.publicKey) : void 0,
				logId: isSet(object.logId) ? sigstore_common_1.LogId.fromJSON(object.logId) : void 0,
				checkpointKeyId: isSet(object.checkpointKeyId) ? sigstore_common_1.LogId.fromJSON(object.checkpointKeyId) : void 0,
				operator: isSet(object.operator) ? globalThis.String(object.operator) : ""
			};
		},
		toJSON(message) {
			let obj = {};
			return message.baseUrl !== "" && (obj.baseUrl = message.baseUrl), message.hashAlgorithm !== 0 && (obj.hashAlgorithm = (0, sigstore_common_1.hashAlgorithmToJSON)(message.hashAlgorithm)), message.publicKey !== void 0 && (obj.publicKey = sigstore_common_1.PublicKey.toJSON(message.publicKey)), message.logId !== void 0 && (obj.logId = sigstore_common_1.LogId.toJSON(message.logId)), message.checkpointKeyId !== void 0 && (obj.checkpointKeyId = sigstore_common_1.LogId.toJSON(message.checkpointKeyId)), message.operator !== "" && (obj.operator = message.operator), obj;
		}
	}, exports.CertificateAuthority = {
		fromJSON(object) {
			return {
				subject: isSet(object.subject) ? sigstore_common_1.DistinguishedName.fromJSON(object.subject) : void 0,
				uri: isSet(object.uri) ? globalThis.String(object.uri) : "",
				certChain: isSet(object.certChain) ? sigstore_common_1.X509CertificateChain.fromJSON(object.certChain) : void 0,
				validFor: isSet(object.validFor) ? sigstore_common_1.TimeRange.fromJSON(object.validFor) : void 0,
				operator: isSet(object.operator) ? globalThis.String(object.operator) : ""
			};
		},
		toJSON(message) {
			let obj = {};
			return message.subject !== void 0 && (obj.subject = sigstore_common_1.DistinguishedName.toJSON(message.subject)), message.uri !== "" && (obj.uri = message.uri), message.certChain !== void 0 && (obj.certChain = sigstore_common_1.X509CertificateChain.toJSON(message.certChain)), message.validFor !== void 0 && (obj.validFor = sigstore_common_1.TimeRange.toJSON(message.validFor)), message.operator !== "" && (obj.operator = message.operator), obj;
		}
	}, exports.TrustedRoot = {
		fromJSON(object) {
			return {
				mediaType: isSet(object.mediaType) ? globalThis.String(object.mediaType) : "",
				tlogs: globalThis.Array.isArray(object?.tlogs) ? object.tlogs.map((e) => exports.TransparencyLogInstance.fromJSON(e)) : [],
				certificateAuthorities: globalThis.Array.isArray(object?.certificateAuthorities) ? object.certificateAuthorities.map((e) => exports.CertificateAuthority.fromJSON(e)) : [],
				ctlogs: globalThis.Array.isArray(object?.ctlogs) ? object.ctlogs.map((e) => exports.TransparencyLogInstance.fromJSON(e)) : [],
				timestampAuthorities: globalThis.Array.isArray(object?.timestampAuthorities) ? object.timestampAuthorities.map((e) => exports.CertificateAuthority.fromJSON(e)) : []
			};
		},
		toJSON(message) {
			let obj = {};
			return message.mediaType !== "" && (obj.mediaType = message.mediaType), message.tlogs?.length && (obj.tlogs = message.tlogs.map((e) => exports.TransparencyLogInstance.toJSON(e))), message.certificateAuthorities?.length && (obj.certificateAuthorities = message.certificateAuthorities.map((e) => exports.CertificateAuthority.toJSON(e))), message.ctlogs?.length && (obj.ctlogs = message.ctlogs.map((e) => exports.TransparencyLogInstance.toJSON(e))), message.timestampAuthorities?.length && (obj.timestampAuthorities = message.timestampAuthorities.map((e) => exports.CertificateAuthority.toJSON(e))), obj;
		}
	}, exports.SigningConfig = {
		fromJSON(object) {
			return {
				mediaType: isSet(object.mediaType) ? globalThis.String(object.mediaType) : "",
				caUrls: globalThis.Array.isArray(object?.caUrls) ? object.caUrls.map((e) => exports.Service.fromJSON(e)) : [],
				oidcUrls: globalThis.Array.isArray(object?.oidcUrls) ? object.oidcUrls.map((e) => exports.Service.fromJSON(e)) : [],
				rekorTlogUrls: globalThis.Array.isArray(object?.rekorTlogUrls) ? object.rekorTlogUrls.map((e) => exports.Service.fromJSON(e)) : [],
				rekorTlogConfig: isSet(object.rekorTlogConfig) ? exports.ServiceConfiguration.fromJSON(object.rekorTlogConfig) : void 0,
				tsaUrls: globalThis.Array.isArray(object?.tsaUrls) ? object.tsaUrls.map((e) => exports.Service.fromJSON(e)) : [],
				tsaConfig: isSet(object.tsaConfig) ? exports.ServiceConfiguration.fromJSON(object.tsaConfig) : void 0
			};
		},
		toJSON(message) {
			let obj = {};
			return message.mediaType !== "" && (obj.mediaType = message.mediaType), message.caUrls?.length && (obj.caUrls = message.caUrls.map((e) => exports.Service.toJSON(e))), message.oidcUrls?.length && (obj.oidcUrls = message.oidcUrls.map((e) => exports.Service.toJSON(e))), message.rekorTlogUrls?.length && (obj.rekorTlogUrls = message.rekorTlogUrls.map((e) => exports.Service.toJSON(e))), message.rekorTlogConfig !== void 0 && (obj.rekorTlogConfig = exports.ServiceConfiguration.toJSON(message.rekorTlogConfig)), message.tsaUrls?.length && (obj.tsaUrls = message.tsaUrls.map((e) => exports.Service.toJSON(e))), message.tsaConfig !== void 0 && (obj.tsaConfig = exports.ServiceConfiguration.toJSON(message.tsaConfig)), obj;
		}
	}, exports.Service = {
		fromJSON(object) {
			return {
				url: isSet(object.url) ? globalThis.String(object.url) : "",
				majorApiVersion: isSet(object.majorApiVersion) ? globalThis.Number(object.majorApiVersion) : 0,
				validFor: isSet(object.validFor) ? sigstore_common_1.TimeRange.fromJSON(object.validFor) : void 0,
				operator: isSet(object.operator) ? globalThis.String(object.operator) : ""
			};
		},
		toJSON(message) {
			let obj = {};
			return message.url !== "" && (obj.url = message.url), message.majorApiVersion !== 0 && (obj.majorApiVersion = Math.round(message.majorApiVersion)), message.validFor !== void 0 && (obj.validFor = sigstore_common_1.TimeRange.toJSON(message.validFor)), message.operator !== "" && (obj.operator = message.operator), obj;
		}
	}, exports.ServiceConfiguration = {
		fromJSON(object) {
			return {
				selector: isSet(object.selector) ? serviceSelectorFromJSON(object.selector) : 0,
				count: isSet(object.count) ? globalThis.Number(object.count) : 0
			};
		},
		toJSON(message) {
			let obj = {};
			return message.selector !== 0 && (obj.selector = serviceSelectorToJSON(message.selector)), message.count !== 0 && (obj.count = Math.round(message.count)), obj;
		}
	}, exports.ClientTrustConfig = {
		fromJSON(object) {
			return {
				mediaType: isSet(object.mediaType) ? globalThis.String(object.mediaType) : "",
				trustedRoot: isSet(object.trustedRoot) ? exports.TrustedRoot.fromJSON(object.trustedRoot) : void 0,
				signingConfig: isSet(object.signingConfig) ? exports.SigningConfig.fromJSON(object.signingConfig) : void 0
			};
		},
		toJSON(message) {
			let obj = {};
			return message.mediaType !== "" && (obj.mediaType = message.mediaType), message.trustedRoot !== void 0 && (obj.trustedRoot = exports.TrustedRoot.toJSON(message.trustedRoot)), message.signingConfig !== void 0 && (obj.signingConfig = exports.SigningConfig.toJSON(message.signingConfig)), obj;
		}
	};
	function isSet(value) {
		return value != null;
	}
})), require_sigstore_verification = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Input = exports.Artifact = exports.ArtifactVerificationOptions_ObserverTimestampOptions = exports.ArtifactVerificationOptions_TlogIntegratedTimestampOptions = exports.ArtifactVerificationOptions_TimestampAuthorityOptions = exports.ArtifactVerificationOptions_CtlogOptions = exports.ArtifactVerificationOptions_TlogOptions = exports.ArtifactVerificationOptions = exports.PublicKeyIdentities = exports.CertificateIdentities = exports.CertificateIdentity = void 0;
	let sigstore_bundle_1 = require_sigstore_bundle(), sigstore_common_1 = require_sigstore_common(), sigstore_trustroot_1 = require_sigstore_trustroot();
	exports.CertificateIdentity = {
		fromJSON(object) {
			return {
				issuer: isSet(object.issuer) ? globalThis.String(object.issuer) : "",
				san: isSet(object.san) ? sigstore_common_1.SubjectAlternativeName.fromJSON(object.san) : void 0,
				oids: globalThis.Array.isArray(object?.oids) ? object.oids.map((e) => sigstore_common_1.ObjectIdentifierValuePair.fromJSON(e)) : []
			};
		},
		toJSON(message) {
			let obj = {};
			return message.issuer !== "" && (obj.issuer = message.issuer), message.san !== void 0 && (obj.san = sigstore_common_1.SubjectAlternativeName.toJSON(message.san)), message.oids?.length && (obj.oids = message.oids.map((e) => sigstore_common_1.ObjectIdentifierValuePair.toJSON(e))), obj;
		}
	}, exports.CertificateIdentities = {
		fromJSON(object) {
			return { identities: globalThis.Array.isArray(object?.identities) ? object.identities.map((e) => exports.CertificateIdentity.fromJSON(e)) : [] };
		},
		toJSON(message) {
			let obj = {};
			return message.identities?.length && (obj.identities = message.identities.map((e) => exports.CertificateIdentity.toJSON(e))), obj;
		}
	}, exports.PublicKeyIdentities = {
		fromJSON(object) {
			return { publicKeys: globalThis.Array.isArray(object?.publicKeys) ? object.publicKeys.map((e) => sigstore_common_1.PublicKey.fromJSON(e)) : [] };
		},
		toJSON(message) {
			let obj = {};
			return message.publicKeys?.length && (obj.publicKeys = message.publicKeys.map((e) => sigstore_common_1.PublicKey.toJSON(e))), obj;
		}
	}, exports.ArtifactVerificationOptions = {
		fromJSON(object) {
			return {
				signers: isSet(object.certificateIdentities) ? {
					$case: "certificateIdentities",
					certificateIdentities: exports.CertificateIdentities.fromJSON(object.certificateIdentities)
				} : isSet(object.publicKeys) ? {
					$case: "publicKeys",
					publicKeys: exports.PublicKeyIdentities.fromJSON(object.publicKeys)
				} : void 0,
				tlogOptions: isSet(object.tlogOptions) ? exports.ArtifactVerificationOptions_TlogOptions.fromJSON(object.tlogOptions) : void 0,
				ctlogOptions: isSet(object.ctlogOptions) ? exports.ArtifactVerificationOptions_CtlogOptions.fromJSON(object.ctlogOptions) : void 0,
				tsaOptions: isSet(object.tsaOptions) ? exports.ArtifactVerificationOptions_TimestampAuthorityOptions.fromJSON(object.tsaOptions) : void 0,
				integratedTsOptions: isSet(object.integratedTsOptions) ? exports.ArtifactVerificationOptions_TlogIntegratedTimestampOptions.fromJSON(object.integratedTsOptions) : void 0,
				observerOptions: isSet(object.observerOptions) ? exports.ArtifactVerificationOptions_ObserverTimestampOptions.fromJSON(object.observerOptions) : void 0
			};
		},
		toJSON(message) {
			let obj = {};
			return message.signers?.$case === "certificateIdentities" ? obj.certificateIdentities = exports.CertificateIdentities.toJSON(message.signers.certificateIdentities) : message.signers?.$case === "publicKeys" && (obj.publicKeys = exports.PublicKeyIdentities.toJSON(message.signers.publicKeys)), message.tlogOptions !== void 0 && (obj.tlogOptions = exports.ArtifactVerificationOptions_TlogOptions.toJSON(message.tlogOptions)), message.ctlogOptions !== void 0 && (obj.ctlogOptions = exports.ArtifactVerificationOptions_CtlogOptions.toJSON(message.ctlogOptions)), message.tsaOptions !== void 0 && (obj.tsaOptions = exports.ArtifactVerificationOptions_TimestampAuthorityOptions.toJSON(message.tsaOptions)), message.integratedTsOptions !== void 0 && (obj.integratedTsOptions = exports.ArtifactVerificationOptions_TlogIntegratedTimestampOptions.toJSON(message.integratedTsOptions)), message.observerOptions !== void 0 && (obj.observerOptions = exports.ArtifactVerificationOptions_ObserverTimestampOptions.toJSON(message.observerOptions)), obj;
		}
	}, exports.ArtifactVerificationOptions_TlogOptions = {
		fromJSON(object) {
			return {
				threshold: isSet(object.threshold) ? globalThis.Number(object.threshold) : 0,
				performOnlineVerification: isSet(object.performOnlineVerification) ? globalThis.Boolean(object.performOnlineVerification) : !1,
				disable: isSet(object.disable) ? globalThis.Boolean(object.disable) : !1
			};
		},
		toJSON(message) {
			let obj = {};
			return message.threshold !== 0 && (obj.threshold = Math.round(message.threshold)), message.performOnlineVerification !== !1 && (obj.performOnlineVerification = message.performOnlineVerification), message.disable !== !1 && (obj.disable = message.disable), obj;
		}
	}, exports.ArtifactVerificationOptions_CtlogOptions = {
		fromJSON(object) {
			return {
				threshold: isSet(object.threshold) ? globalThis.Number(object.threshold) : 0,
				disable: isSet(object.disable) ? globalThis.Boolean(object.disable) : !1
			};
		},
		toJSON(message) {
			let obj = {};
			return message.threshold !== 0 && (obj.threshold = Math.round(message.threshold)), message.disable !== !1 && (obj.disable = message.disable), obj;
		}
	}, exports.ArtifactVerificationOptions_TimestampAuthorityOptions = {
		fromJSON(object) {
			return {
				threshold: isSet(object.threshold) ? globalThis.Number(object.threshold) : 0,
				disable: isSet(object.disable) ? globalThis.Boolean(object.disable) : !1
			};
		},
		toJSON(message) {
			let obj = {};
			return message.threshold !== 0 && (obj.threshold = Math.round(message.threshold)), message.disable !== !1 && (obj.disable = message.disable), obj;
		}
	}, exports.ArtifactVerificationOptions_TlogIntegratedTimestampOptions = {
		fromJSON(object) {
			return {
				threshold: isSet(object.threshold) ? globalThis.Number(object.threshold) : 0,
				disable: isSet(object.disable) ? globalThis.Boolean(object.disable) : !1
			};
		},
		toJSON(message) {
			let obj = {};
			return message.threshold !== 0 && (obj.threshold = Math.round(message.threshold)), message.disable !== !1 && (obj.disable = message.disable), obj;
		}
	}, exports.ArtifactVerificationOptions_ObserverTimestampOptions = {
		fromJSON(object) {
			return {
				threshold: isSet(object.threshold) ? globalThis.Number(object.threshold) : 0,
				disable: isSet(object.disable) ? globalThis.Boolean(object.disable) : !1
			};
		},
		toJSON(message) {
			let obj = {};
			return message.threshold !== 0 && (obj.threshold = Math.round(message.threshold)), message.disable !== !1 && (obj.disable = message.disable), obj;
		}
	}, exports.Artifact = {
		fromJSON(object) {
			return { data: isSet(object.artifactUri) ? {
				$case: "artifactUri",
				artifactUri: globalThis.String(object.artifactUri)
			} : isSet(object.artifact) ? {
				$case: "artifact",
				artifact: Buffer.from(bytesFromBase64(object.artifact))
			} : isSet(object.artifactDigest) ? {
				$case: "artifactDigest",
				artifactDigest: sigstore_common_1.HashOutput.fromJSON(object.artifactDigest)
			} : void 0 };
		},
		toJSON(message) {
			let obj = {};
			return message.data?.$case === "artifactUri" ? obj.artifactUri = message.data.artifactUri : message.data?.$case === "artifact" ? obj.artifact = base64FromBytes(message.data.artifact) : message.data?.$case === "artifactDigest" && (obj.artifactDigest = sigstore_common_1.HashOutput.toJSON(message.data.artifactDigest)), obj;
		}
	}, exports.Input = {
		fromJSON(object) {
			return {
				artifactTrustRoot: isSet(object.artifactTrustRoot) ? sigstore_trustroot_1.TrustedRoot.fromJSON(object.artifactTrustRoot) : void 0,
				artifactVerificationOptions: isSet(object.artifactVerificationOptions) ? exports.ArtifactVerificationOptions.fromJSON(object.artifactVerificationOptions) : void 0,
				bundle: isSet(object.bundle) ? sigstore_bundle_1.Bundle.fromJSON(object.bundle) : void 0,
				artifact: isSet(object.artifact) ? exports.Artifact.fromJSON(object.artifact) : void 0
			};
		},
		toJSON(message) {
			let obj = {};
			return message.artifactTrustRoot !== void 0 && (obj.artifactTrustRoot = sigstore_trustroot_1.TrustedRoot.toJSON(message.artifactTrustRoot)), message.artifactVerificationOptions !== void 0 && (obj.artifactVerificationOptions = exports.ArtifactVerificationOptions.toJSON(message.artifactVerificationOptions)), message.bundle !== void 0 && (obj.bundle = sigstore_bundle_1.Bundle.toJSON(message.bundle)), message.artifact !== void 0 && (obj.artifact = exports.Artifact.toJSON(message.artifact)), obj;
		}
	};
	function bytesFromBase64(b64) {
		return Uint8Array.from(globalThis.Buffer.from(b64, "base64"));
	}
	function base64FromBytes(arr) {
		return globalThis.Buffer.from(arr).toString("base64");
	}
	function isSet(value) {
		return value != null;
	}
})), require_dist$6 = __commonJSMin(((exports) => {
	var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k);
		var desc = Object.getOwnPropertyDescriptor(m, k);
		(!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) && (desc = {
			enumerable: !0,
			get: function() {
				return m[k];
			}
		}), Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k), o[k2] = m[k];
	})), __exportStar = exports && exports.__exportStar || function(m, exports$2) {
		for (var p in m) p !== "default" && !Object.prototype.hasOwnProperty.call(exports$2, p) && __createBinding(exports$2, m, p);
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), __exportStar(require_envelope(), exports), __exportStar(require_sigstore_bundle(), exports), __exportStar(require_sigstore_common(), exports), __exportStar(require_sigstore_rekor(), exports), __exportStar(require_sigstore_trustroot(), exports), __exportStar(require_sigstore_verification(), exports);
})), require_bundle$1 = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.BUNDLE_V03_MEDIA_TYPE = exports.BUNDLE_V03_LEGACY_MEDIA_TYPE = exports.BUNDLE_V02_MEDIA_TYPE = exports.BUNDLE_V01_MEDIA_TYPE = void 0, exports.isBundleWithCertificateChain = isBundleWithCertificateChain, exports.isBundleWithPublicKey = isBundleWithPublicKey, exports.isBundleWithMessageSignature = isBundleWithMessageSignature, exports.isBundleWithDsseEnvelope = isBundleWithDsseEnvelope, exports.BUNDLE_V01_MEDIA_TYPE = "application/vnd.dev.sigstore.bundle+json;version=0.1", exports.BUNDLE_V02_MEDIA_TYPE = "application/vnd.dev.sigstore.bundle+json;version=0.2", exports.BUNDLE_V03_LEGACY_MEDIA_TYPE = "application/vnd.dev.sigstore.bundle+json;version=0.3", exports.BUNDLE_V03_MEDIA_TYPE = "application/vnd.dev.sigstore.bundle.v0.3+json";
	function isBundleWithCertificateChain(b) {
		return b.verificationMaterial.content.$case === "x509CertificateChain";
	}
	function isBundleWithPublicKey(b) {
		return b.verificationMaterial.content.$case === "publicKey";
	}
	function isBundleWithMessageSignature(b) {
		return b.content.$case === "messageSignature";
	}
	function isBundleWithDsseEnvelope(b) {
		return b.content.$case === "dsseEnvelope";
	}
})), require_build = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.toMessageSignatureBundle = toMessageSignatureBundle, exports.toDSSEBundle = toDSSEBundle;
	let protobuf_specs_1 = require_dist$6(), bundle_1 = require_bundle$1();
	function toMessageSignatureBundle(options) {
		return {
			mediaType: options.certificateChain ? bundle_1.BUNDLE_V02_MEDIA_TYPE : bundle_1.BUNDLE_V03_MEDIA_TYPE,
			content: {
				$case: "messageSignature",
				messageSignature: {
					messageDigest: {
						algorithm: protobuf_specs_1.HashAlgorithm.SHA2_256,
						digest: options.digest
					},
					signature: options.signature
				}
			},
			verificationMaterial: toVerificationMaterial(options)
		};
	}
	function toDSSEBundle(options) {
		return {
			mediaType: options.certificateChain ? bundle_1.BUNDLE_V02_MEDIA_TYPE : bundle_1.BUNDLE_V03_MEDIA_TYPE,
			content: {
				$case: "dsseEnvelope",
				dsseEnvelope: toEnvelope(options)
			},
			verificationMaterial: toVerificationMaterial(options)
		};
	}
	function toEnvelope(options) {
		return {
			payloadType: options.artifactType,
			payload: options.artifact,
			signatures: [toSignature(options)]
		};
	}
	function toSignature(options) {
		return {
			keyid: options.keyHint || "",
			sig: options.signature
		};
	}
	function toVerificationMaterial(options) {
		return {
			content: toKeyContent(options),
			tlogEntries: [],
			timestampVerificationData: { rfc3161Timestamps: [] }
		};
	}
	function toKeyContent(options) {
		return options.certificate ? options.certificateChain ? {
			$case: "x509CertificateChain",
			x509CertificateChain: { certificates: [{ rawBytes: options.certificate }] }
		} : {
			$case: "certificate",
			certificate: { rawBytes: options.certificate }
		} : {
			$case: "publicKey",
			publicKey: { hint: options.keyHint || "" }
		};
	}
})), require_error$6 = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.ValidationError = void 0, exports.ValidationError = class extends Error {
		fields;
		constructor(message, fields) {
			super(message), this.fields = fields;
		}
	};
})), require_validate = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.assertBundle = assertBundle, exports.assertBundleV01 = assertBundleV01, exports.isBundleV01 = isBundleV01, exports.assertBundleV02 = assertBundleV02, exports.assertBundleLatest = assertBundleLatest;
	let error_1 = require_error$6();
	function assertBundle(b) {
		let invalidValues = validateBundleBase(b);
		if (invalidValues.length > 0) throw new error_1.ValidationError("invalid bundle", invalidValues);
	}
	function assertBundleV01(b) {
		let invalidValues = [];
		if (invalidValues.push(...validateBundleBase(b)), invalidValues.push(...validateInclusionPromise(b)), invalidValues.length > 0) throw new error_1.ValidationError("invalid v0.1 bundle", invalidValues);
	}
	function isBundleV01(b) {
		try {
			return assertBundleV01(b), !0;
		} catch {
			return !1;
		}
	}
	function assertBundleV02(b) {
		let invalidValues = [];
		if (invalidValues.push(...validateBundleBase(b)), invalidValues.push(...validateInclusionProof(b)), invalidValues.length > 0) throw new error_1.ValidationError("invalid v0.2 bundle", invalidValues);
	}
	function assertBundleLatest(b) {
		let invalidValues = [];
		if (invalidValues.push(...validateBundleBase(b)), invalidValues.push(...validateInclusionProof(b)), invalidValues.push(...validateNoCertificateChain(b)), invalidValues.length > 0) throw new error_1.ValidationError("invalid bundle", invalidValues);
	}
	function validateBundleBase(b) {
		let invalidValues = [];
		if ((b.mediaType === void 0 || !b.mediaType.match(/^application\/vnd\.dev\.sigstore\.bundle\+json;version=\d\.\d/) && !b.mediaType.match(/^application\/vnd\.dev\.sigstore\.bundle\.v\d\.\d\+json/)) && invalidValues.push("mediaType"), b.content === void 0) invalidValues.push("content");
		else switch (b.content.$case) {
			case "messageSignature":
				b.content.messageSignature.messageDigest === void 0 ? invalidValues.push("content.messageSignature.messageDigest") : b.content.messageSignature.messageDigest.digest.length === 0 && invalidValues.push("content.messageSignature.messageDigest.digest"), b.content.messageSignature.signature.length === 0 && invalidValues.push("content.messageSignature.signature");
				break;
			case "dsseEnvelope": b.content.dsseEnvelope.payload.length === 0 && invalidValues.push("content.dsseEnvelope.payload"), b.content.dsseEnvelope.signatures.length === 1 ? b.content.dsseEnvelope.signatures[0].sig.length === 0 && invalidValues.push("content.dsseEnvelope.signatures[0].sig") : invalidValues.push("content.dsseEnvelope.signatures");
		}
		if (b.verificationMaterial === void 0) invalidValues.push("verificationMaterial");
		else {
			if (b.verificationMaterial.content === void 0) invalidValues.push("verificationMaterial.content");
			else switch (b.verificationMaterial.content.$case) {
				case "x509CertificateChain":
					b.verificationMaterial.content.x509CertificateChain.certificates.length === 0 && invalidValues.push("verificationMaterial.content.x509CertificateChain.certificates"), b.verificationMaterial.content.x509CertificateChain.certificates.forEach((cert, i) => {
						cert.rawBytes.length === 0 && invalidValues.push(`verificationMaterial.content.x509CertificateChain.certificates[${i}].rawBytes`);
					});
					break;
				case "certificate": b.verificationMaterial.content.certificate.rawBytes.length === 0 && invalidValues.push("verificationMaterial.content.certificate.rawBytes");
			}
			b.verificationMaterial.tlogEntries === void 0 ? invalidValues.push("verificationMaterial.tlogEntries") : b.verificationMaterial.tlogEntries.length > 0 && b.verificationMaterial.tlogEntries.forEach((entry, i) => {
				entry.logId === void 0 && invalidValues.push(`verificationMaterial.tlogEntries[${i}].logId`), entry.kindVersion === void 0 && invalidValues.push(`verificationMaterial.tlogEntries[${i}].kindVersion`);
			});
		}
		return invalidValues;
	}
	function validateInclusionPromise(b) {
		let invalidValues = [];
		return b.verificationMaterial && b.verificationMaterial.tlogEntries?.length > 0 && b.verificationMaterial.tlogEntries.forEach((entry, i) => {
			entry.inclusionPromise === void 0 && invalidValues.push(`verificationMaterial.tlogEntries[${i}].inclusionPromise`);
		}), invalidValues;
	}
	function validateInclusionProof(b) {
		let invalidValues = [];
		return b.verificationMaterial && b.verificationMaterial.tlogEntries?.length > 0 && b.verificationMaterial.tlogEntries.forEach((entry, i) => {
			entry.inclusionProof === void 0 ? invalidValues.push(`verificationMaterial.tlogEntries[${i}].inclusionProof`) : entry.inclusionProof.checkpoint === void 0 && invalidValues.push(`verificationMaterial.tlogEntries[${i}].inclusionProof.checkpoint`);
		}), invalidValues;
	}
	function validateNoCertificateChain(b) {
		let invalidValues = [];
		return b.verificationMaterial?.content?.$case === "x509CertificateChain" && invalidValues.push("verificationMaterial.content.$case"), invalidValues;
	}
})), require_serialized = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.envelopeToJSON = exports.envelopeFromJSON = exports.bundleToJSON = exports.bundleFromJSON = void 0;
	let protobuf_specs_1 = require_dist$6(), bundle_1 = require_bundle$1(), validate_1 = require_validate();
	exports.bundleFromJSON = (obj) => {
		let bundle = protobuf_specs_1.Bundle.fromJSON(obj);
		switch (bundle.mediaType) {
			case bundle_1.BUNDLE_V01_MEDIA_TYPE:
				(0, validate_1.assertBundleV01)(bundle);
				break;
			case bundle_1.BUNDLE_V02_MEDIA_TYPE:
				(0, validate_1.assertBundleV02)(bundle);
				break;
			default: (0, validate_1.assertBundleLatest)(bundle);
		}
		return bundle;
	}, exports.bundleToJSON = (bundle) => protobuf_specs_1.Bundle.toJSON(bundle), exports.envelopeFromJSON = (obj) => protobuf_specs_1.Envelope.fromJSON(obj), exports.envelopeToJSON = (envelope) => protobuf_specs_1.Envelope.toJSON(envelope);
})), require_dist$5 = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.isBundleV01 = exports.assertBundleV02 = exports.assertBundleV01 = exports.assertBundleLatest = exports.assertBundle = exports.envelopeToJSON = exports.envelopeFromJSON = exports.bundleToJSON = exports.bundleFromJSON = exports.ValidationError = exports.isBundleWithPublicKey = exports.isBundleWithMessageSignature = exports.isBundleWithDsseEnvelope = exports.isBundleWithCertificateChain = exports.BUNDLE_V03_MEDIA_TYPE = exports.BUNDLE_V03_LEGACY_MEDIA_TYPE = exports.BUNDLE_V02_MEDIA_TYPE = exports.BUNDLE_V01_MEDIA_TYPE = exports.toMessageSignatureBundle = exports.toDSSEBundle = void 0;
	var build_1 = require_build();
	Object.defineProperty(exports, "toDSSEBundle", {
		enumerable: !0,
		get: function() {
			return build_1.toDSSEBundle;
		}
	}), Object.defineProperty(exports, "toMessageSignatureBundle", {
		enumerable: !0,
		get: function() {
			return build_1.toMessageSignatureBundle;
		}
	});
	var bundle_1 = require_bundle$1();
	Object.defineProperty(exports, "BUNDLE_V01_MEDIA_TYPE", {
		enumerable: !0,
		get: function() {
			return bundle_1.BUNDLE_V01_MEDIA_TYPE;
		}
	}), Object.defineProperty(exports, "BUNDLE_V02_MEDIA_TYPE", {
		enumerable: !0,
		get: function() {
			return bundle_1.BUNDLE_V02_MEDIA_TYPE;
		}
	}), Object.defineProperty(exports, "BUNDLE_V03_LEGACY_MEDIA_TYPE", {
		enumerable: !0,
		get: function() {
			return bundle_1.BUNDLE_V03_LEGACY_MEDIA_TYPE;
		}
	}), Object.defineProperty(exports, "BUNDLE_V03_MEDIA_TYPE", {
		enumerable: !0,
		get: function() {
			return bundle_1.BUNDLE_V03_MEDIA_TYPE;
		}
	}), Object.defineProperty(exports, "isBundleWithCertificateChain", {
		enumerable: !0,
		get: function() {
			return bundle_1.isBundleWithCertificateChain;
		}
	}), Object.defineProperty(exports, "isBundleWithDsseEnvelope", {
		enumerable: !0,
		get: function() {
			return bundle_1.isBundleWithDsseEnvelope;
		}
	}), Object.defineProperty(exports, "isBundleWithMessageSignature", {
		enumerable: !0,
		get: function() {
			return bundle_1.isBundleWithMessageSignature;
		}
	}), Object.defineProperty(exports, "isBundleWithPublicKey", {
		enumerable: !0,
		get: function() {
			return bundle_1.isBundleWithPublicKey;
		}
	});
	var error_1 = require_error$6();
	Object.defineProperty(exports, "ValidationError", {
		enumerable: !0,
		get: function() {
			return error_1.ValidationError;
		}
	});
	var serialized_1 = require_serialized();
	Object.defineProperty(exports, "bundleFromJSON", {
		enumerable: !0,
		get: function() {
			return serialized_1.bundleFromJSON;
		}
	}), Object.defineProperty(exports, "bundleToJSON", {
		enumerable: !0,
		get: function() {
			return serialized_1.bundleToJSON;
		}
	}), Object.defineProperty(exports, "envelopeFromJSON", {
		enumerable: !0,
		get: function() {
			return serialized_1.envelopeFromJSON;
		}
	}), Object.defineProperty(exports, "envelopeToJSON", {
		enumerable: !0,
		get: function() {
			return serialized_1.envelopeToJSON;
		}
	});
	var validate_1 = require_validate();
	Object.defineProperty(exports, "assertBundle", {
		enumerable: !0,
		get: function() {
			return validate_1.assertBundle;
		}
	}), Object.defineProperty(exports, "assertBundleLatest", {
		enumerable: !0,
		get: function() {
			return validate_1.assertBundleLatest;
		}
	}), Object.defineProperty(exports, "assertBundleV01", {
		enumerable: !0,
		get: function() {
			return validate_1.assertBundleV01;
		}
	}), Object.defineProperty(exports, "assertBundleV02", {
		enumerable: !0,
		get: function() {
			return validate_1.assertBundleV02;
		}
	}), Object.defineProperty(exports, "isBundleV01", {
		enumerable: !0,
		get: function() {
			return validate_1.isBundleV01;
		}
	});
})), require_appdata = __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.appDataPath = appDataPath;
	let os_1$1 = __importDefault(require("os")), path_1$2 = __importDefault(require("path"));
	function appDataPath(name) {
		let homedir = os_1$1.default.homedir();
		switch (process.platform) {
			case "darwin": {
				let appSupport = path_1$2.default.join(homedir, "Library", "Application Support");
				return path_1$2.default.join(appSupport, name);
			}
			case "win32": {
				let localAppData = process.env.LOCALAPPDATA || path_1$2.default.join(homedir, "AppData", "Local");
				return path_1$2.default.join(localAppData, name, "Data");
			}
			default: {
				let localData = process.env.XDG_DATA_HOME || path_1$2.default.join(homedir, ".local", "share");
				return path_1$2.default.join(localData, name);
			}
		}
	}
})), require_error$5 = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.UnsupportedAlgorithmError = exports.CryptoError = exports.LengthOrHashMismatchError = exports.UnsignedMetadataError = exports.RepositoryError = exports.ValueError = void 0, exports.ValueError = class extends Error {};
	var RepositoryError = class extends Error {};
	exports.RepositoryError = RepositoryError, exports.UnsignedMetadataError = class extends RepositoryError {}, exports.LengthOrHashMismatchError = class extends RepositoryError {};
	var CryptoError = class extends Error {};
	exports.CryptoError = CryptoError, exports.UnsupportedAlgorithmError = class extends CryptoError {};
})), require_guard = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.isDefined = isDefined, exports.isObject = isObject, exports.isStringArray = isStringArray, exports.isObjectArray = isObjectArray, exports.isStringRecord = isStringRecord, exports.isObjectRecord = isObjectRecord;
	function isDefined(val) {
		return val !== void 0;
	}
	function isObject(value) {
		return typeof value == "object" && !!value;
	}
	function isStringArray(value) {
		return Array.isArray(value) && value.every((v) => typeof v == "string");
	}
	function isObjectArray(value) {
		return Array.isArray(value) && value.every(isObject);
	}
	function isStringRecord(value) {
		return typeof value == "object" && !!value && Object.keys(value).every((k) => typeof k == "string") && Object.values(value).every((v) => typeof v == "string");
	}
	function isObjectRecord(value) {
		return typeof value == "object" && !!value && Object.keys(value).every((k) => typeof k == "string") && Object.values(value).every((v) => typeof v == "object" && !!v);
	}
})), require_lib$1 = __commonJSMin(((exports, module) => {
	function canonicalize(object) {
		let buffer = [];
		if (typeof object == "string") buffer.push(canonicalizeString(object));
		else if (typeof object == "boolean") buffer.push(JSON.stringify(object));
		else if (Number.isInteger(object)) buffer.push(JSON.stringify(object));
		else if (object === null) buffer.push(JSON.stringify(object));
		else if (Array.isArray(object)) {
			buffer.push("[");
			let first = !0;
			object.forEach((element) => {
				first || buffer.push(","), first = !1, buffer.push(canonicalize(element));
			}), buffer.push("]");
		} else if (typeof object == "object") {
			buffer.push("{");
			let first = !0;
			Object.keys(object).sort().forEach((property) => {
				first || buffer.push(","), first = !1, buffer.push(canonicalizeString(property)), buffer.push(":"), buffer.push(canonicalize(object[property]));
			}), buffer.push("}");
		} else throw TypeError("cannot encode " + object.toString());
		return buffer.join("");
	}
	function canonicalizeString(string) {
		return "\"" + string.replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"";
	}
	module.exports = { canonicalize };
})), require_verify = __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.verifySignature = void 0;
	let canonical_json_1 = require_lib$1(), crypto_1$4 = __importDefault(require("crypto"));
	exports.verifySignature = (metaDataSignedData, key, signature) => {
		let canonicalData = Buffer.from((0, canonical_json_1.canonicalize)(metaDataSignedData));
		return crypto_1$4.default.verify(void 0, canonicalData, key, Buffer.from(signature, "hex"));
	};
})), require_utils = __commonJSMin(((exports) => {
	var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k);
		var desc = Object.getOwnPropertyDescriptor(m, k);
		(!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) && (desc = {
			enumerable: !0,
			get: function() {
				return m[k];
			}
		}), Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k), o[k2] = m[k];
	})), __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
		Object.defineProperty(o, "default", {
			enumerable: !0,
			value: v
		});
	}) : function(o, v) {
		o.default = v;
	}), __importStar = exports && exports.__importStar || (function() {
		var ownKeys = function(o) {
			return ownKeys = Object.getOwnPropertyNames || function(o) {
				var ar = [];
				for (var k in o) Object.prototype.hasOwnProperty.call(o, k) && (ar[ar.length] = k);
				return ar;
			}, ownKeys(o);
		};
		return function(mod) {
			if (mod && mod.__esModule) return mod;
			var result = {};
			if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) k[i] !== "default" && __createBinding(result, mod, k[i]);
			return __setModuleDefault(result, mod), result;
		};
	})();
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.crypto = exports.guard = void 0, exports.guard = __importStar(require_guard()), exports.crypto = __importStar(require_verify());
})), require_base = __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Signed = exports.MetadataKind = void 0, exports.isMetadataKind = isMetadataKind;
	let util_1$10 = __importDefault(require("util")), error_1 = require_error$5(), utils_1 = require_utils(), SPECIFICATION_VERSION = [
		"1",
		"0",
		"31"
	];
	var MetadataKind;
	(function(MetadataKind) {
		MetadataKind.Root = "root", MetadataKind.Timestamp = "timestamp", MetadataKind.Snapshot = "snapshot", MetadataKind.Targets = "targets";
	})(MetadataKind || (exports.MetadataKind = MetadataKind = {}));
	function isMetadataKind(value) {
		return typeof value == "string" && Object.values(MetadataKind).includes(value);
	}
	exports.Signed = class Signed {
		specVersion;
		expires;
		version;
		unrecognizedFields;
		constructor(options) {
			this.specVersion = options.specVersion || SPECIFICATION_VERSION.join(".");
			let specList = this.specVersion.split(".");
			if (specList.length !== 2 && specList.length !== 3 || !specList.every((item) => isNumeric(item))) throw new error_1.ValueError("Failed to parse specVersion");
			if (specList[0] != SPECIFICATION_VERSION[0]) throw new error_1.ValueError("Unsupported specVersion");
			this.expires = options.expires, this.version = options.version, this.unrecognizedFields = options.unrecognizedFields || {};
		}
		equals(other) {
			return other instanceof Signed && this.specVersion === other.specVersion && this.expires === other.expires && this.version === other.version && util_1$10.default.isDeepStrictEqual(this.unrecognizedFields, other.unrecognizedFields);
		}
		isExpired(referenceTime) {
			return referenceTime ||= new Date(), referenceTime >= new Date(this.expires);
		}
		static commonFieldsFromJSON(data) {
			let { spec_version, expires, version, ...rest } = data;
			if (!utils_1.guard.isDefined(spec_version)) throw new error_1.ValueError("spec_version is not defined");
			if (typeof spec_version != "string") throw TypeError("spec_version must be a string");
			if (!utils_1.guard.isDefined(expires)) throw new error_1.ValueError("expires is not defined");
			if (typeof expires != "string") throw TypeError("expires must be a string");
			if (!utils_1.guard.isDefined(version)) throw new error_1.ValueError("version is not defined");
			if (typeof version != "number") throw TypeError("version must be a number");
			return {
				specVersion: spec_version,
				expires,
				version,
				unrecognizedFields: rest
			};
		}
	};
	function isNumeric(str) {
		return !isNaN(Number(str));
	}
})), require_file = __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.TargetFile = exports.MetaFile = void 0;
	let crypto_1$3 = __importDefault(require("crypto")), util_1$9 = __importDefault(require("util")), error_1 = require_error$5(), utils_1 = require_utils();
	exports.MetaFile = class MetaFile {
		version;
		length;
		hashes;
		unrecognizedFields;
		constructor(opts) {
			if (opts.version <= 0) throw new error_1.ValueError("Metafile version must be at least 1");
			opts.length !== void 0 && validateLength(opts.length), this.version = opts.version, this.length = opts.length, this.hashes = opts.hashes, this.unrecognizedFields = opts.unrecognizedFields || {};
		}
		equals(other) {
			return other instanceof MetaFile && this.version === other.version && this.length === other.length && util_1$9.default.isDeepStrictEqual(this.hashes, other.hashes) && util_1$9.default.isDeepStrictEqual(this.unrecognizedFields, other.unrecognizedFields);
		}
		verify(data) {
			if (this.length !== void 0 && data.length !== this.length) throw new error_1.LengthOrHashMismatchError(`Expected length ${this.length} but got ${data.length}`);
			this.hashes && Object.entries(this.hashes).forEach(([key, value]) => {
				let hash;
				try {
					hash = crypto_1$3.default.createHash(key);
				} catch {
					throw new error_1.LengthOrHashMismatchError(`Hash algorithm ${key} not supported`);
				}
				let observedHash = hash.update(data).digest("hex");
				if (observedHash !== value) throw new error_1.LengthOrHashMismatchError(`Expected hash ${value} but got ${observedHash}`);
			});
		}
		toJSON() {
			let json = {
				version: this.version,
				...this.unrecognizedFields
			};
			return this.length !== void 0 && (json.length = this.length), this.hashes && (json.hashes = this.hashes), json;
		}
		static fromJSON(data) {
			let { version, length, hashes, ...rest } = data;
			if (typeof version != "number") throw TypeError("version must be a number");
			if (utils_1.guard.isDefined(length) && typeof length != "number") throw TypeError("length must be a number");
			if (utils_1.guard.isDefined(hashes) && !utils_1.guard.isStringRecord(hashes)) throw TypeError("hashes must be string keys and values");
			return new MetaFile({
				version,
				length,
				hashes,
				unrecognizedFields: rest
			});
		}
	}, exports.TargetFile = class TargetFile {
		length;
		path;
		hashes;
		unrecognizedFields;
		constructor(opts) {
			validateLength(opts.length), this.length = opts.length, this.path = opts.path, this.hashes = opts.hashes, this.unrecognizedFields = opts.unrecognizedFields || {};
		}
		get custom() {
			let custom = this.unrecognizedFields.custom;
			return !custom || Array.isArray(custom) || typeof custom != "object" ? {} : custom;
		}
		equals(other) {
			return other instanceof TargetFile && this.length === other.length && this.path === other.path && util_1$9.default.isDeepStrictEqual(this.hashes, other.hashes) && util_1$9.default.isDeepStrictEqual(this.unrecognizedFields, other.unrecognizedFields);
		}
		async verify(stream) {
			let observedLength = 0, digests = Object.keys(this.hashes).reduce((acc, key) => {
				try {
					acc[key] = crypto_1$3.default.createHash(key);
				} catch {
					throw new error_1.LengthOrHashMismatchError(`Hash algorithm ${key} not supported`);
				}
				return acc;
			}, {});
			for await (let chunk of stream) observedLength += chunk.length, Object.values(digests).forEach((digest) => {
				digest.update(chunk);
			});
			if (observedLength !== this.length) throw new error_1.LengthOrHashMismatchError(`Expected length ${this.length} but got ${observedLength}`);
			Object.entries(digests).forEach(([key, value]) => {
				let expected = this.hashes[key], actual = value.digest("hex");
				if (actual !== expected) throw new error_1.LengthOrHashMismatchError(`Expected hash ${expected} but got ${actual}`);
			});
		}
		toJSON() {
			return {
				length: this.length,
				hashes: this.hashes,
				...this.unrecognizedFields
			};
		}
		static fromJSON(path, data) {
			let { length, hashes, ...rest } = data;
			if (typeof length != "number") throw TypeError("length must be a number");
			if (!utils_1.guard.isStringRecord(hashes)) throw TypeError("hashes must have string keys and values");
			return new TargetFile({
				length,
				path,
				hashes,
				unrecognizedFields: rest
			});
		}
	};
	function validateLength(length) {
		if (length < 0) throw new error_1.ValueError("Length must be at least 0");
	}
})), require_oid$1 = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.encodeOIDString = encodeOIDString;
	function encodeOIDString(oid) {
		let parts = oid.split("."), first = parseInt(parts[0], 10) * 40 + parseInt(parts[1], 10), rest = [];
		parts.slice(2).forEach((part) => {
			let bytes = encodeVariableLengthInteger(parseInt(part, 10));
			rest.push(...bytes);
		});
		let der = Buffer.from([first, ...rest]);
		return Buffer.from([
			6,
			der.length,
			...der
		]);
	}
	function encodeVariableLengthInteger(value) {
		let bytes = [], mask = 0;
		for (; value > 0;) bytes.unshift(value & 127 | mask), value >>= 7, mask = 128;
		return bytes;
	}
})), require_key$2 = __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.getPublicKey = getPublicKey;
	let crypto_1$2 = __importDefault(require("crypto")), error_1 = require_error$5(), oid_1 = require_oid$1(), PEM_HEADER = "-----BEGIN PUBLIC KEY-----";
	function getPublicKey(keyInfo) {
		switch (keyInfo.keyType) {
			case "rsa": return getRSAPublicKey(keyInfo);
			case "ed25519": return getED25519PublicKey(keyInfo);
			case "ecdsa":
			case "ecdsa-sha2-nistp256":
			case "ecdsa-sha2-nistp384": return getECDCSAPublicKey(keyInfo);
			default: throw new error_1.UnsupportedAlgorithmError(`Unsupported key type: ${keyInfo.keyType}`);
		}
	}
	function getRSAPublicKey(keyInfo) {
		if (!keyInfo.keyVal.startsWith(PEM_HEADER)) throw new error_1.CryptoError("Invalid key format");
		let key = crypto_1$2.default.createPublicKey(keyInfo.keyVal);
		switch (keyInfo.scheme) {
			case "rsassa-pss-sha256": return {
				key,
				padding: crypto_1$2.default.constants.RSA_PKCS1_PSS_PADDING
			};
			default: throw new error_1.UnsupportedAlgorithmError(`Unsupported RSA scheme: ${keyInfo.scheme}`);
		}
	}
	function getED25519PublicKey(keyInfo) {
		let key;
		if (keyInfo.keyVal.startsWith(PEM_HEADER)) key = crypto_1$2.default.createPublicKey(keyInfo.keyVal);
		else {
			if (!isHex(keyInfo.keyVal)) throw new error_1.CryptoError("Invalid key format");
			key = crypto_1$2.default.createPublicKey({
				key: ed25519.hexToDER(keyInfo.keyVal),
				format: "der",
				type: "spki"
			});
		}
		return { key };
	}
	function getECDCSAPublicKey(keyInfo) {
		let key;
		if (keyInfo.keyVal.startsWith(PEM_HEADER)) key = crypto_1$2.default.createPublicKey(keyInfo.keyVal);
		else {
			if (!isHex(keyInfo.keyVal)) throw new error_1.CryptoError("Invalid key format");
			key = crypto_1$2.default.createPublicKey({
				key: ecdsa.hexToDER(keyInfo.keyVal),
				format: "der",
				type: "spki"
			});
		}
		return { key };
	}
	let ed25519 = { hexToDER: (hex) => {
		let key = Buffer.from(hex, "hex"), oid = (0, oid_1.encodeOIDString)("1.3.101.112"), elements = Buffer.concat([Buffer.concat([
			Buffer.from([48]),
			Buffer.from([oid.length]),
			oid
		]), Buffer.concat([
			Buffer.from([3]),
			Buffer.from([key.length + 1]),
			Buffer.from([0]),
			key
		])]);
		return Buffer.concat([
			Buffer.from([48]),
			Buffer.from([elements.length]),
			elements
		]);
	} }, ecdsa = { hexToDER: (hex) => {
		let key = Buffer.from(hex, "hex"), bitString = Buffer.concat([
			Buffer.from([3]),
			Buffer.from([key.length + 1]),
			Buffer.from([0]),
			key
		]), oids = Buffer.concat([(0, oid_1.encodeOIDString)("1.2.840.10045.2.1"), (0, oid_1.encodeOIDString)("1.2.840.10045.3.1.7")]), oidSequence = Buffer.concat([
			Buffer.from([48]),
			Buffer.from([oids.length]),
			oids
		]);
		return Buffer.concat([
			Buffer.from([48]),
			Buffer.from([oidSequence.length + bitString.length]),
			oidSequence,
			bitString
		]);
	} }, isHex = (key) => /^[0-9a-fA-F]+$/.test(key);
})), require_key$1 = __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Key = void 0;
	let util_1$8 = __importDefault(require("util")), error_1 = require_error$5(), utils_1 = require_utils(), key_1 = require_key$2();
	exports.Key = class Key {
		keyID;
		keyType;
		scheme;
		keyVal;
		unrecognizedFields;
		constructor(options) {
			let { keyID, keyType, scheme, keyVal, unrecognizedFields } = options;
			this.keyID = keyID, this.keyType = keyType, this.scheme = scheme, this.keyVal = keyVal, this.unrecognizedFields = unrecognizedFields || {};
		}
		verifySignature(metadata) {
			let signature = metadata.signatures[this.keyID];
			if (!signature) throw new error_1.UnsignedMetadataError("no signature for key found in metadata");
			if (!this.keyVal.public) throw new error_1.UnsignedMetadataError("no public key found");
			let publicKey = (0, key_1.getPublicKey)({
				keyType: this.keyType,
				scheme: this.scheme,
				keyVal: this.keyVal.public
			}), signedData = metadata.signed.toJSON();
			try {
				if (!utils_1.crypto.verifySignature(signedData, publicKey, signature.sig)) throw new error_1.UnsignedMetadataError(`failed to verify ${this.keyID} signature`);
			} catch (error) {
				throw error instanceof error_1.UnsignedMetadataError ? error : new error_1.UnsignedMetadataError(`failed to verify ${this.keyID} signature`);
			}
		}
		equals(other) {
			return other instanceof Key && this.keyID === other.keyID && this.keyType === other.keyType && this.scheme === other.scheme && util_1$8.default.isDeepStrictEqual(this.keyVal, other.keyVal) && util_1$8.default.isDeepStrictEqual(this.unrecognizedFields, other.unrecognizedFields);
		}
		toJSON() {
			return {
				keytype: this.keyType,
				scheme: this.scheme,
				keyval: this.keyVal,
				...this.unrecognizedFields
			};
		}
		static fromJSON(keyID, data) {
			let { keytype, scheme, keyval, ...rest } = data;
			if (typeof keytype != "string") throw TypeError("keytype must be a string");
			if (typeof scheme != "string") throw TypeError("scheme must be a string");
			if (!utils_1.guard.isStringRecord(keyval)) throw TypeError("keyval must be a string record");
			return new Key({
				keyID,
				keyType: keytype,
				scheme,
				keyVal: keyval,
				unrecognizedFields: rest
			});
		}
	};
})), require_commonjs$2 = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.range = exports.balanced = void 0, exports.balanced = (a, b, str) => {
		let ma = a instanceof RegExp ? maybeMatch(a, str) : a, mb = b instanceof RegExp ? maybeMatch(b, str) : b, r = ma !== null && mb != null && (0, exports.range)(ma, mb, str);
		return r && {
			start: r[0],
			end: r[1],
			pre: str.slice(0, r[0]),
			body: str.slice(r[0] + ma.length, r[1]),
			post: str.slice(r[1] + mb.length)
		};
	};
	let maybeMatch = (reg, str) => {
		let m = str.match(reg);
		return m ? m[0] : null;
	};
	exports.range = (a, b, str) => {
		let begs, beg, left, right, result, ai = str.indexOf(a), bi = str.indexOf(b, ai + 1), i = ai;
		if (ai >= 0 && bi > 0) {
			if (a === b) return [ai, bi];
			for (begs = [], left = str.length; i >= 0 && !result;) {
				if (i === ai) begs.push(i), ai = str.indexOf(a, i + 1);
				else if (begs.length === 1) {
					let r = begs.pop();
					r !== void 0 && (result = [r, bi]);
				} else beg = begs.pop(), beg !== void 0 && beg < left && (left = beg, right = bi), bi = str.indexOf(b, i + 1);
				i = ai < bi && ai >= 0 ? ai : bi;
			}
			begs.length && right !== void 0 && (result = [left, right]);
		}
		return result;
	};
})), require_commonjs$1 = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.EXPANSION_MAX_REWRITES = exports.EXPANSION_MAX_DEPTH = exports.EXPANSION_MAX_LENGTH = exports.EXPANSION_MAX = void 0, exports.expand = expand;
	let balanced_match_1 = require_commonjs$2(), escSlash = "\0SLASH" + Math.random() + "\0", escOpen = "\0OPEN" + Math.random() + "\0", escClose = "\0CLOSE" + Math.random() + "\0", escComma = "\0COMMA" + Math.random() + "\0", escPeriod = "\0PERIOD" + Math.random() + "\0", escSlashPattern = new RegExp(escSlash, "g"), escOpenPattern = new RegExp(escOpen, "g"), escClosePattern = new RegExp(escClose, "g"), escCommaPattern = new RegExp(escComma, "g"), escPeriodPattern = new RegExp(escPeriod, "g"), slashPattern = /\\\\/g, openPattern = /\\{/g, closePattern = /\\}/g, commaPattern = /\\,/g, periodPattern = /\\\./g;
	exports.EXPANSION_MAX = 1e5, exports.EXPANSION_MAX_LENGTH = 4e6, exports.EXPANSION_MAX_DEPTH = 1e3, exports.EXPANSION_MAX_REWRITES = 1e3;
	function numeric(str) {
		return isNaN(str) ? str.charCodeAt(0) : parseInt(str, 10);
	}
	function escapeBraces(str) {
		return str.replace(slashPattern, escSlash).replace(openPattern, escOpen).replace(closePattern, escClose).replace(commaPattern, escComma).replace(periodPattern, escPeriod);
	}
	function unescapeBraces(str) {
		return str.replace(escSlashPattern, "\\").replace(escOpenPattern, "{").replace(escClosePattern, "}").replace(escCommaPattern, ",").replace(escPeriodPattern, ".");
	}
	function pushAll(target, items) {
		for (let i = 0; i < items.length; i++) target.push(items[i]);
	}
	function parseCommaParts(str) {
		let parts = [], carry = "";
		for (;;) {
			let m = (0, balanced_match_1.balanced)("{", "}", str);
			if (!m) {
				let tail = str.split(",");
				return tail[0] = carry + tail[0], pushAll(parts, tail), parts;
			}
			let { pre, body, post } = m, p = pre.split(",");
			if (p[0] = carry + p[0], p[p.length - 1] += "{" + body + "}", !post.length) return pushAll(parts, p), parts;
			carry = p.pop(), pushAll(parts, p), str = post;
		}
	}
	function expand(str, options = {}) {
		if (!str) return [];
		let { max = exports.EXPANSION_MAX, maxLength = exports.EXPANSION_MAX_LENGTH, maxDepth = exports.EXPANSION_MAX_DEPTH, maxRewrites = exports.EXPANSION_MAX_REWRITES } = options;
		return str.slice(0, 2) === "{}" && (str = "\\{\\}" + str.slice(2)), expand_(escapeBraces(str), max, maxLength, maxDepth, 0, maxRewrites, !0).map(unescapeBraces);
	}
	function embrace(str) {
		return "{" + str + "}";
	}
	function isPadded(el) {
		return /^-?0\d/.test(el);
	}
	function lte(i, y) {
		return i <= y;
	}
	function gte(i, y) {
		return i >= y;
	}
	function combine(acc, pre, values, max, maxLength, dropEmpties) {
		let out = [], length = 0;
		for (let a = 0; a < acc.length; a++) for (let v = 0; v < values.length; v++) {
			if (out.length >= max) return out;
			let expansion = acc[a] + pre + values[v];
			if (!dropEmpties || expansion) {
				if (length + expansion.length > maxLength) return out;
				out.push(expansion), length += expansion.length;
			}
		}
		return out;
	}
	function expandSequence(body, isAlphaSequence, max, maxLength) {
		let n = body.split(/\.\./), N = [];
		if (n[0] === void 0 || n[1] === void 0) return N;
		let x = numeric(n[0]), y = numeric(n[1]), width = Math.max(n[0].length, n[1].length), incr = n.length === 3 && n[2] !== void 0 ? Math.max(Math.abs(numeric(n[2])), 1) : 1, test = lte;
		y < x && (incr *= -1, test = gte);
		let pad = n.some(isPadded), length = 0;
		for (let i = x; test(i, y) && N.length < max; i += incr) {
			let c;
			if (isAlphaSequence) c = String.fromCharCode(i), c === "\\" && (c = "");
			else if (c = String(i), pad) {
				let need = width - c.length;
				if (need > 0) {
					let z = Array(need + 1).join("0");
					c = i < 0 ? "-" + z + c.slice(1) : z + c;
				}
			}
			if (length + c.length > maxLength) break;
			N.push(c), length += c.length;
		}
		return N;
	}
	function expand_(str, max, maxLength, maxDepth, depth, maxRewrites, isTop) {
		if (depth > maxDepth) return [str];
		let acc = [""], rewrites = 0, dropEmpties = !1, firstGroup = !0;
		for (;;) {
			let m = (0, balanced_match_1.balanced)("{", "}", str);
			if (!m) return combine(acc, str, [""], max, maxLength, dropEmpties);
			let pre = m.pre;
			if (/\$$/.test(pre)) {
				if (acc = combine(acc, pre + "{" + m.body + "}", [""], max, maxLength, dropEmpties && !m.post.length), firstGroup = !1, !m.post.length) break;
				str = m.post;
				continue;
			}
			let isNumericSequence = /^-?\d+\.\.-?\d+(?:\.\.-?\d+)?$/.test(m.body), isAlphaSequence = /^[a-zA-Z]\.\.[a-zA-Z](?:\.\.-?\d+)?$/.test(m.body), isSequence = isNumericSequence || isAlphaSequence, isOptions = m.body.indexOf(",") >= 0;
			if (!isSequence && !isOptions) {
				if (rewrites < maxRewrites && m.post.match(/,(?!,).*\}/)) {
					rewrites++, str = m.pre + "{" + m.body + escClose + m.post, isTop = !0;
					continue;
				}
				return combine(acc, pre + "{" + m.body + "}" + m.post, [""], max, maxLength, dropEmpties);
			}
			firstGroup &&= (dropEmpties = isTop && !isSequence, !1);
			let values;
			if (isSequence) values = expandSequence(m.body, isAlphaSequence, max, maxLength);
			else {
				let n = parseCommaParts(m.body);
				if (n.length === 1 && n[0] !== void 0 && (n = expand_(n[0], max, maxLength, maxDepth, depth + 1, maxRewrites, !1).map(embrace), n.length === 1)) {
					if (acc = combine(acc, pre + n[0], [""], max, maxLength, dropEmpties && !m.post.length), !m.post.length) break;
					str = m.post;
					continue;
				}
				let dropsEmpties = dropEmpties && !m.post.length && !pre;
				for (let d = 0; dropsEmpties && d < acc.length; d++) acc[d] && (dropsEmpties = !1);
				values = [];
				let valuesLength = 0;
				outer: for (let j = 0; j < n.length; j++) {
					let expanded = expand_(n[j], max, maxLength, maxDepth, depth + 1, maxRewrites, !1);
					for (let k = 0; k < expanded.length; k++) {
						let v = expanded[k];
						if (!dropsEmpties || v) {
							if (values.length >= max || valuesLength + v.length > maxLength) break outer;
							values.push(v), valuesLength += v.length;
						}
					}
				}
			}
			if (acc = combine(acc, pre, values, max, maxLength, dropEmpties && !m.post.length), !m.post.length) break;
			str = m.post;
		}
		return acc;
	}
})), require_assert_valid_pattern = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.assertValidPattern = void 0, exports.assertValidPattern = (pattern) => {
		if (typeof pattern != "string") throw TypeError("invalid pattern");
		if (pattern.length > 65536) throw TypeError("pattern is too long");
	};
})), require_brace_expressions = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.parseClass = void 0;
	let posixClasses = {
		"[:alnum:]": ["\\p{L}\\p{Nl}\\p{Nd}", !0],
		"[:alpha:]": ["\\p{L}\\p{Nl}", !0],
		"[:ascii:]": ["\\x00-\\x7f", !1],
		"[:blank:]": ["\\p{Zs}\\t", !0],
		"[:cntrl:]": ["\\p{Cc}", !0],
		"[:digit:]": ["\\p{Nd}", !0],
		"[:graph:]": [
			"\\p{Z}\\p{C}",
			!0,
			!0
		],
		"[:lower:]": ["\\p{Ll}", !0],
		"[:print:]": ["\\p{C}", !0],
		"[:punct:]": ["\\p{P}", !0],
		"[:space:]": ["\\p{Z}\\t\\r\\n\\v\\f", !0],
		"[:upper:]": ["\\p{Lu}", !0],
		"[:word:]": ["\\p{L}\\p{Nl}\\p{Nd}\\p{Pc}", !0],
		"[:xdigit:]": ["A-Fa-f0-9", !1]
	}, braceEscape = (s) => s.replace(/[[\]\\-]/g, "\\$&"), regexpEscape = (s) => s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&"), rangesToString = (ranges) => ranges.join("");
	exports.parseClass = (glob, position) => {
		let pos = position;
		if (glob.charAt(pos) !== "[") throw Error("not in a brace expression");
		let ranges = [], negs = [], i = pos + 1, sawStart = !1, uflag = !1, escaping = !1, negate = !1, endPos = pos, rangeStart = "";
		WHILE: for (; i < glob.length;) {
			let c = glob.charAt(i);
			if ((c === "!" || c === "^") && i === pos + 1) {
				negate = !0, i++;
				continue;
			}
			if (c === "]" && sawStart && !escaping) {
				endPos = i + 1;
				break;
			}
			if (sawStart = !0, c === "\\" && !escaping) {
				escaping = !0, i++;
				continue;
			}
			if (c === "[" && !escaping) {
				for (let [cls, [unip, u, neg]] of Object.entries(posixClasses)) if (glob.startsWith(cls, i)) {
					if (rangeStart) return [
						"$.",
						!1,
						glob.length - pos,
						!0
					];
					i += cls.length, neg ? negs.push(unip) : ranges.push(unip), uflag ||= u;
					continue WHILE;
				}
			}
			if (escaping = !1, rangeStart) {
				c > rangeStart ? ranges.push(braceEscape(rangeStart) + "-" + braceEscape(c)) : c === rangeStart && ranges.push(braceEscape(c)), rangeStart = "", i++;
				continue;
			}
			if (glob.startsWith("-]", i + 1)) {
				ranges.push(braceEscape(c + "-")), i += 2;
				continue;
			}
			if (glob.startsWith("-", i + 1)) {
				rangeStart = c, i += 2;
				continue;
			}
			ranges.push(braceEscape(c)), i++;
		}
		if (endPos < i) return [
			"",
			!1,
			0,
			!1
		];
		if (!ranges.length && !negs.length) return [
			"$.",
			!1,
			glob.length - pos,
			!0
		];
		if (negs.length === 0 && ranges.length === 1 && /^\\?.$/.test(ranges[0]) && !negate) {
			let r = ranges[0].length === 2 ? ranges[0].slice(-1) : ranges[0];
			return [
				regexpEscape(r),
				!1,
				endPos - pos,
				!1
			];
		}
		let sranges = "[" + (negate ? "^" : "") + rangesToString(ranges) + "]", snegs = "[" + (negate ? "" : "^") + rangesToString(negs) + "]";
		return [
			ranges.length && negs.length ? "(" + sranges + "|" + snegs + ")" : ranges.length ? sranges : snegs,
			uflag,
			endPos - pos,
			!0
		];
	};
})), require_unescape = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.unescape = void 0, exports.unescape = (s, { windowsPathsNoEscape = !1, magicalBraces = !0 } = {}) => magicalBraces ? windowsPathsNoEscape ? s.replace(/\[([^/\\])\]/g, "$1") : s.replace(/((?!\\).|^)\[([^/\\])\]/g, "$1$2").replace(/\\([^/])/g, "$1") : windowsPathsNoEscape ? s.replace(/\[([^/\\{}])\]/g, "$1") : s.replace(/((?!\\).|^)\[([^/\\{}])\]/g, "$1$2").replace(/\\([^/{}])/g, "$1");
})), require_ast = __commonJSMin(((exports) => {
	var _a;
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.AST = void 0;
	let brace_expressions_js_1 = require_brace_expressions(), unescape_js_1 = require_unescape(), types = new Set([
		"!",
		"?",
		"+",
		"*",
		"@"
	]), isExtglobType = (c) => types.has(c), isExtglobAST = (c) => isExtglobType(c.type), adoptionMap = new Map([
		["!", ["@"]],
		["?", ["?", "@"]],
		["@", ["@"]],
		["*", [
			"*",
			"+",
			"?",
			"@"
		]],
		["+", ["+", "@"]]
	]), adoptionWithSpaceMap = new Map([
		["!", ["?"]],
		["@", ["?"]],
		["+", ["?", "*"]]
	]), adoptionAnyMap = new Map([
		["!", ["?", "@"]],
		["?", ["?", "@"]],
		["@", ["?", "@"]],
		["*", [
			"*",
			"+",
			"?",
			"@"
		]],
		["+", [
			"+",
			"@",
			"?",
			"*"
		]]
	]), usurpMap = new Map([
		["!", new Map([["!", "@"]])],
		["?", new Map([["*", "*"], ["+", "*"]])],
		["@", new Map([
			["!", "!"],
			["?", "?"],
			["@", "@"],
			["*", "*"],
			["+", "+"]
		])],
		["+", new Map([["?", "*"], ["*", "*"]])]
	]), startNoDot = "(?!\\.)", addPatternStart = new Set(["[", "."]), justDots = new Set(["..", "."]), reSpecials = new Set("().*{}+?[]^$\\!"), regExpEscape = (s) => s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&"), starNoEmpty = "[^/]+?", ID = 0;
	var AST = class {
		type;
		#root;
		#hasMagic;
		#uflag = !1;
		#parts = [];
		#parent;
		#parentIndex;
		#negs;
		#filledNegs = !1;
		#options;
		#toString;
		#emptyExt = !1;
		id = ++ID;
		get depth() {
			return (this.#parent?.depth ?? -1) + 1;
		}
		[Symbol.for("nodejs.util.inspect.custom")]() {
			return {
				"@@type": "AST",
				id: this.id,
				type: this.type,
				root: this.#root.id,
				parent: this.#parent?.id,
				depth: this.depth,
				partsLength: this.#parts.length,
				parts: this.#parts
			};
		}
		constructor(type, parent, options = {}) {
			this.type = type, type && (this.#hasMagic = !0), this.#parent = parent, this.#root = this.#parent ? this.#parent.#root : this, this.#options = this.#root === this ? options : this.#root.#options, this.#negs = this.#root === this ? [] : this.#root.#negs, type === "!" && !this.#root.#filledNegs && this.#negs.push(this), this.#parentIndex = this.#parent ? this.#parent.#parts.length : 0;
		}
		get hasMagic() {
			if (this.#hasMagic !== void 0) return this.#hasMagic;
			for (let p of this.#parts) if (typeof p != "string" && (p.type || p.hasMagic)) return this.#hasMagic = !0;
			return this.#hasMagic;
		}
		toString() {
			return this.#toString === void 0 ? this.#toString = this.type ? this.type + "(" + this.#parts.map((p) => String(p)).join("|") + ")" : this.#parts.map((p) => String(p)).join("") : this.#toString;
		}
		#fillNegs() {
			if (this !== this.#root) throw Error("should only call on root");
			if (this.#filledNegs) return this;
			this.toString(), this.#filledNegs = !0;
			let n;
			for (; n = this.#negs.pop();) {
				if (n.type !== "!") continue;
				let p = n, pp = p.#parent;
				for (; pp;) {
					for (let i = p.#parentIndex + 1; !pp.type && i < pp.#parts.length; i++) for (let part of n.#parts) {
						if (typeof part == "string") throw Error("string part in extglob AST??");
						part.copyIn(pp.#parts[i]);
					}
					p = pp, pp = p.#parent;
				}
			}
			return this;
		}
		push(...parts) {
			for (let p of parts) if (p !== "") {
				if (typeof p != "string" && !(p instanceof _a && p.#parent === this)) throw Error("invalid part: " + p);
				this.#parts.push(p);
			}
		}
		toJSON() {
			let ret = this.type === null ? this.#parts.slice().map((p) => typeof p == "string" ? p : p.toJSON()) : [this.type, ...this.#parts.map((p) => p.toJSON())];
			return this.isStart() && !this.type && ret.unshift([]), this.isEnd() && (this === this.#root || this.#root.#filledNegs && this.#parent?.type === "!") && ret.push({}), ret;
		}
		isStart() {
			if (this.#root === this) return !0;
			if (!this.#parent?.isStart()) return !1;
			if (this.#parentIndex === 0) return !0;
			let p = this.#parent;
			for (let i = 0; i < this.#parentIndex; i++) {
				let pp = p.#parts[i];
				if (!(pp instanceof _a && pp.type === "!")) return !1;
			}
			return !0;
		}
		isEnd() {
			if (this.#root === this || this.#parent?.type === "!") return !0;
			if (!this.#parent?.isEnd()) return !1;
			if (!this.type) return this.#parent?.isEnd();
			let pl = this.#parent ? this.#parent.#parts.length : 0;
			return this.#parentIndex === pl - 1;
		}
		copyIn(part) {
			typeof part == "string" ? this.push(part) : this.push(part.clone(this));
		}
		clone(parent) {
			let c = new _a(this.type, parent);
			for (let p of this.#parts) c.copyIn(p);
			return c;
		}
		static #parseAST(str, ast, pos, opt, extDepth) {
			let maxDepth = opt.maxExtglobRecursion ?? 2, escaping = !1, inBrace = !1, braceStart = -1, braceNeg = !1;
			if (ast.type === null) {
				let i = pos, acc = "";
				for (; i < str.length;) {
					let c = str.charAt(i++);
					if (escaping || c === "\\") {
						escaping = !escaping, acc += c;
						continue;
					}
					if (inBrace) {
						i === braceStart + 1 ? (c === "^" || c === "!") && (braceNeg = !0) : c === "]" && !(i === braceStart + 2 && braceNeg) && (inBrace = !1), acc += c;
						continue;
					}
					if (c === "[") {
						inBrace = !0, braceStart = i, braceNeg = !1, acc += c;
						continue;
					}
					if (!opt.noext && isExtglobType(c) && str.charAt(i) === "(" && extDepth <= maxDepth) {
						ast.push(acc), acc = "";
						let ext = new _a(c, ast);
						i = _a.#parseAST(str, ext, i, opt, extDepth + 1), ast.push(ext);
						continue;
					}
					acc += c;
				}
				return ast.push(acc), i;
			}
			let i = pos + 1, part = new _a(null, ast), parts = [], acc = "";
			for (; i < str.length;) {
				let c = str.charAt(i++);
				if (escaping || c === "\\") {
					escaping = !escaping, acc += c;
					continue;
				}
				if (inBrace) {
					i === braceStart + 1 ? (c === "^" || c === "!") && (braceNeg = !0) : c === "]" && !(i === braceStart + 2 && braceNeg) && (inBrace = !1), acc += c;
					continue;
				}
				if (c === "[") {
					inBrace = !0, braceStart = i, braceNeg = !1, acc += c;
					continue;
				}
				if (!opt.noext && isExtglobType(c) && str.charAt(i) === "(" && (extDepth <= maxDepth || ast && ast.#canAdoptType(c))) {
					let depthAdd = ast && ast.#canAdoptType(c) ? 0 : 1;
					part.push(acc), acc = "";
					let ext = new _a(c, part);
					part.push(ext), i = _a.#parseAST(str, ext, i, opt, extDepth + depthAdd);
					continue;
				}
				if (c === "|") {
					part.push(acc), acc = "", parts.push(part), part = new _a(null, ast);
					continue;
				}
				if (c === ")") return acc === "" && ast.#parts.length === 0 && (ast.#emptyExt = !0), part.push(acc), acc = "", ast.push(...parts, part), i;
				acc += c;
			}
			return ast.type = null, ast.#hasMagic = void 0, ast.#parts = [str.substring(pos - 1)], i;
		}
		#canAdoptWithSpace(child) {
			return this.#canAdopt(child, adoptionWithSpaceMap);
		}
		#canAdopt(child, map = adoptionMap) {
			if (!child || typeof child != "object" || child.type !== null || child.#parts.length !== 1 || this.type === null) return !1;
			let gc = child.#parts[0];
			return !gc || typeof gc != "object" || gc.type === null ? !1 : this.#canAdoptType(gc.type, map);
		}
		#canAdoptType(c, map = adoptionAnyMap) {
			return !!map.get(this.type)?.includes(c);
		}
		#adoptWithSpace(child, index) {
			let gc = child.#parts[0], blank = new _a(null, gc, this.options);
			blank.#parts.push(""), gc.push(blank), this.#adopt(child, index);
		}
		#adopt(child, index) {
			let gc = child.#parts[0];
			this.#parts.splice(index, 1, ...gc.#parts);
			for (let p of gc.#parts) typeof p == "object" && (p.#parent = this);
			this.#toString = void 0;
		}
		#canUsurpType(c) {
			return !!usurpMap.get(this.type)?.has(c);
		}
		#canUsurp(child) {
			if (!child || typeof child != "object" || child.type !== null || child.#parts.length !== 1 || this.type === null || this.#parts.length !== 1) return !1;
			let gc = child.#parts[0];
			return !gc || typeof gc != "object" || gc.type === null ? !1 : this.#canUsurpType(gc.type);
		}
		#usurp(child) {
			let m = usurpMap.get(this.type), gc = child.#parts[0], nt = m?.get(gc.type);
			if (!nt) return !1;
			this.#parts = gc.#parts;
			for (let p of this.#parts) typeof p == "object" && (p.#parent = this);
			this.type = nt, this.#toString = void 0, this.#emptyExt = !1;
		}
		static fromGlob(pattern, options = {}) {
			let ast = new _a(null, void 0, options);
			return _a.#parseAST(pattern, ast, 0, options, 0), ast;
		}
		toMMPattern() {
			if (this !== this.#root) return this.#root.toMMPattern();
			let glob = this.toString(), [re, body, hasMagic, uflag] = this.toRegExpSource();
			if (!(hasMagic || this.#hasMagic || this.#options.nocase && !this.#options.nocaseMagicOnly && glob.toUpperCase() !== glob.toLowerCase())) return body;
			let flags = (this.#options.nocase ? "i" : "") + (uflag ? "u" : "");
			return Object.assign(RegExp(`^${re}$`, flags), {
				_src: re,
				_glob: glob
			});
		}
		get options() {
			return this.#options;
		}
		toRegExpSource(allowDot) {
			let dot = allowDot ?? !!this.#options.dot;
			if (this.#root === this && (this.#flatten(), this.#fillNegs()), !isExtglobAST(this)) {
				let noEmpty = this.isStart() && this.isEnd() && !this.#parts.some((s) => typeof s != "string"), src = this.#parts.map((p) => {
					let [re, _, hasMagic, uflag] = typeof p == "string" ? _a.#parseGlob(p, this.#hasMagic, noEmpty) : p.toRegExpSource(allowDot);
					return this.#hasMagic = this.#hasMagic || hasMagic, this.#uflag = this.#uflag || uflag, re;
				}).join(""), start = "";
				if (this.isStart() && typeof this.#parts[0] == "string" && !(this.#parts.length === 1 && justDots.has(this.#parts[0]))) {
					let aps = addPatternStart, needNoTrav = dot && aps.has(src.charAt(0)) || src.startsWith("\\.") && aps.has(src.charAt(2)) || src.startsWith("\\.\\.") && aps.has(src.charAt(4)), needNoDot = !dot && !allowDot && aps.has(src.charAt(0));
					start = needNoTrav ? "(?!(?:^|/)\\.\\.?(?:$|/))" : needNoDot ? startNoDot : "";
				}
				let end = "";
				return this.isEnd() && this.#root.#filledNegs && this.#parent?.type === "!" && (end = "(?:$|\\/)"), [
					start + src + end,
					(0, unescape_js_1.unescape)(src),
					this.#hasMagic = !!this.#hasMagic,
					this.#uflag
				];
			}
			let repeated = this.type === "*" || this.type === "+", start = this.type === "!" ? "(?:(?!(?:" : "(?:", body = this.#partsToRegExp(dot);
			if (this.isStart() && this.isEnd() && !body && this.type !== "!") {
				let s = this.toString(), me = this;
				return me.#parts = [s], me.type = null, me.#hasMagic = void 0, [
					s,
					(0, unescape_js_1.unescape)(this.toString()),
					!1,
					!1
				];
			}
			let bodyDotAllowed = !repeated || allowDot || dot ? "" : this.#partsToRegExp(!0);
			bodyDotAllowed === body && (bodyDotAllowed = ""), bodyDotAllowed && (body = `(?:${body})(?:${bodyDotAllowed})*?`);
			let final = "";
			if (this.type === "!" && this.#emptyExt) final = (this.isStart() && !dot ? startNoDot : "") + starNoEmpty;
			else {
				let close = this.type === "!" ? "))" + (this.isStart() && !dot && !allowDot ? startNoDot : "") + "[^/]*?)" : this.type === "@" ? ")" : this.type === "?" ? ")?" : this.type === "+" && bodyDotAllowed ? ")" : this.type === "*" && bodyDotAllowed ? ")?" : `)${this.type}`;
				final = start + body + close;
			}
			return [
				final,
				(0, unescape_js_1.unescape)(body),
				this.#hasMagic = !!this.#hasMagic,
				this.#uflag
			];
		}
		#flatten() {
			if (isExtglobAST(this)) {
				let iterations = 0, done = !1;
				do {
					done = !0;
					for (let i = 0; i < this.#parts.length; i++) {
						let c = this.#parts[i];
						typeof c == "object" && (c.#flatten(), this.#canAdopt(c) ? (done = !1, this.#adopt(c, i)) : this.#canAdoptWithSpace(c) ? (done = !1, this.#adoptWithSpace(c, i)) : this.#canUsurp(c) && (done = !1, this.#usurp(c)));
					}
				} while (!done && ++iterations < 10);
			} else for (let p of this.#parts) typeof p == "object" && p.#flatten();
			this.#toString = void 0;
		}
		#partsToRegExp(dot) {
			return this.#parts.map((p) => {
				if (typeof p == "string") throw Error("string type in extglob ast??");
				let [re, _, _hasMagic, uflag] = p.toRegExpSource(dot);
				return this.#uflag = this.#uflag || uflag, re;
			}).filter((p) => !(this.isStart() && this.isEnd()) || !!p).join("|");
		}
		static #parseGlob(glob, hasMagic, noEmpty = !1) {
			let escaping = !1, re = "", uflag = !1, inStar = !1;
			for (let i = 0; i < glob.length; i++) {
				let c = glob.charAt(i);
				if (escaping) {
					escaping = !1, re += (reSpecials.has(c) ? "\\" : "") + c;
					continue;
				}
				if (c === "*") {
					if (inStar) continue;
					inStar = !0, re += noEmpty && /^[*]+$/.test(glob) ? starNoEmpty : "[^/]*?", hasMagic = !0;
					continue;
				}
				if (inStar = !1, c === "\\") {
					i === glob.length - 1 ? re += "\\\\" : escaping = !0;
					continue;
				}
				if (c === "[") {
					let [src, needUflag, consumed, magic] = (0, brace_expressions_js_1.parseClass)(glob, i);
					if (consumed) {
						re += src, uflag ||= needUflag, i += consumed - 1, hasMagic ||= magic;
						continue;
					}
				}
				if (c === "?") {
					re += "[^/]", hasMagic = !0;
					continue;
				}
				re += regExpEscape(c);
			}
			return [
				re,
				(0, unescape_js_1.unescape)(glob),
				!!hasMagic,
				uflag
			];
		}
	};
	exports.AST = AST, _a = AST;
})), require_escape = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.escape = void 0, exports.escape = (s, { windowsPathsNoEscape = !1, magicalBraces = !1 } = {}) => magicalBraces ? windowsPathsNoEscape ? s.replace(/[?*()[\]{}]/g, "[$&]") : s.replace(/[?*()[\]\\{}]/g, "\\$&") : windowsPathsNoEscape ? s.replace(/[?*()[\]]/g, "[$&]") : s.replace(/[?*()[\]\\]/g, "\\$&");
})), require_commonjs = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.unescape = exports.escape = exports.AST = exports.Minimatch = exports.match = exports.makeRe = exports.braceExpand = exports.defaults = exports.filter = exports.GLOBSTAR = exports.sep = exports.minimatch = void 0;
	let brace_expansion_1 = require_commonjs$1(), assert_valid_pattern_js_1 = require_assert_valid_pattern(), ast_js_1 = require_ast(), escape_js_1 = require_escape(), unescape_js_1 = require_unescape();
	exports.minimatch = (p, pattern, options = {}) => ((0, assert_valid_pattern_js_1.assertValidPattern)(pattern), !options.nocomment && pattern.charAt(0) === "#" ? !1 : new Minimatch(pattern, options).match(p));
	let starDotExtRE = /^\*+([^+@!?*[(]*)$/, starDotExtTest = (ext) => (f) => !f.startsWith(".") && f.endsWith(ext), starDotExtTestDot = (ext) => (f) => f.endsWith(ext), starDotExtTestNocase = (ext) => (ext = ext.toLowerCase(), (f) => !f.startsWith(".") && f.toLowerCase().endsWith(ext)), starDotExtTestNocaseDot = (ext) => (ext = ext.toLowerCase(), (f) => f.toLowerCase().endsWith(ext)), starDotStarRE = /^\*+\.\*+$/, starDotStarTest = (f) => !f.startsWith(".") && f.includes("."), starDotStarTestDot = (f) => f !== "." && f !== ".." && f.includes("."), dotStarRE = /^\.\*+$/, dotStarTest = (f) => f !== "." && f !== ".." && f.startsWith("."), starRE = /^\*+$/, starTest = (f) => f.length !== 0 && !f.startsWith("."), starTestDot = (f) => f.length !== 0 && f !== "." && f !== "..", qmarksRE = /^\?+([^+@!?*[(]*)?$/, qmarksTestNocase = ([$0, ext = ""]) => {
		let noext = qmarksTestNoExt([$0]);
		return ext ? (ext = ext.toLowerCase(), (f) => noext(f) && f.toLowerCase().endsWith(ext)) : noext;
	}, qmarksTestNocaseDot = ([$0, ext = ""]) => {
		let noext = qmarksTestNoExtDot([$0]);
		return ext ? (ext = ext.toLowerCase(), (f) => noext(f) && f.toLowerCase().endsWith(ext)) : noext;
	}, qmarksTestDot = ([$0, ext = ""]) => {
		let noext = qmarksTestNoExtDot([$0]);
		return ext ? (f) => noext(f) && f.endsWith(ext) : noext;
	}, qmarksTest = ([$0, ext = ""]) => {
		let noext = qmarksTestNoExt([$0]);
		return ext ? (f) => noext(f) && f.endsWith(ext) : noext;
	}, qmarksTestNoExt = ([$0]) => {
		let len = $0.length;
		return (f) => f.length === len && !f.startsWith(".");
	}, qmarksTestNoExtDot = ([$0]) => {
		let len = $0.length;
		return (f) => f.length === len && f !== "." && f !== "..";
	}, defaultPlatform = typeof process == "object" && process ? typeof process.env == "object" && process.env && process.env.__MINIMATCH_TESTING_PLATFORM__ || process.platform : "posix", path = {
		win32: { sep: "\\" },
		posix: { sep: "/" }
	};
	exports.sep = defaultPlatform === "win32" ? path.win32.sep : path.posix.sep, exports.minimatch.sep = exports.sep, exports.GLOBSTAR = Symbol("globstar **"), exports.minimatch.GLOBSTAR = exports.GLOBSTAR, exports.filter = (pattern, options = {}) => (p) => (0, exports.minimatch)(p, pattern, options), exports.minimatch.filter = exports.filter;
	let ext = (a, b = {}) => Object.assign({}, a, b);
	exports.defaults = (def) => {
		if (!def || typeof def != "object" || !Object.keys(def).length) return exports.minimatch;
		let orig = exports.minimatch;
		return Object.assign((p, pattern, options = {}) => orig(p, pattern, ext(def, options)), {
			Minimatch: class extends orig.Minimatch {
				constructor(pattern, options = {}) {
					super(pattern, ext(def, options));
				}
				static defaults(options) {
					return orig.defaults(ext(def, options)).Minimatch;
				}
			},
			AST: class extends orig.AST {
				constructor(type, parent, options = {}) {
					super(type, parent, ext(def, options));
				}
				static fromGlob(pattern, options = {}) {
					return orig.AST.fromGlob(pattern, ext(def, options));
				}
			},
			unescape: (s, options = {}) => orig.unescape(s, ext(def, options)),
			escape: (s, options = {}) => orig.escape(s, ext(def, options)),
			filter: (pattern, options = {}) => orig.filter(pattern, ext(def, options)),
			defaults: (options) => orig.defaults(ext(def, options)),
			makeRe: (pattern, options = {}) => orig.makeRe(pattern, ext(def, options)),
			braceExpand: (pattern, options = {}) => orig.braceExpand(pattern, ext(def, options)),
			match: (list, pattern, options = {}) => orig.match(list, pattern, ext(def, options)),
			sep: orig.sep,
			GLOBSTAR: exports.GLOBSTAR
		});
	}, exports.minimatch.defaults = exports.defaults, exports.braceExpand = (pattern, options = {}) => ((0, assert_valid_pattern_js_1.assertValidPattern)(pattern), options.nobrace || !/\{(?:(?!\{).)*\}/.test(pattern) ? [pattern] : (0, brace_expansion_1.expand)(pattern, { max: options.braceExpandMax })), exports.minimatch.braceExpand = exports.braceExpand, exports.makeRe = (pattern, options = {}) => new Minimatch(pattern, options).makeRe(), exports.minimatch.makeRe = exports.makeRe, exports.match = (list, pattern, options = {}) => {
		let mm = new Minimatch(pattern, options);
		return list = list.filter((f) => mm.match(f)), mm.options.nonull && !list.length && list.push(pattern), list;
	}, exports.minimatch.match = exports.match;
	let globMagic = /[?*]|[+@!]\(.*?\)|\[|\]/, regExpEscape = (s) => s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
	var Minimatch = class {
		options;
		set;
		pattern;
		windowsPathsNoEscape;
		nonegate;
		negate;
		comment;
		empty;
		preserveMultipleSlashes;
		partial;
		globSet;
		globParts;
		nocase;
		isWindows;
		platform;
		windowsNoMagicRoot;
		maxGlobstarRecursion;
		regexp;
		constructor(pattern, options = {}) {
			(0, assert_valid_pattern_js_1.assertValidPattern)(pattern), options ||= {}, this.options = options, this.maxGlobstarRecursion = options.maxGlobstarRecursion ?? 200, this.pattern = pattern, this.platform = options.platform || defaultPlatform, this.isWindows = this.platform === "win32", this.windowsPathsNoEscape = !!options.windowsPathsNoEscape || options.allowWindowsEscape === !1, this.windowsPathsNoEscape && (this.pattern = this.pattern.replace(/\\/g, "/")), this.preserveMultipleSlashes = !!options.preserveMultipleSlashes, this.regexp = null, this.negate = !1, this.nonegate = !!options.nonegate, this.comment = !1, this.empty = !1, this.partial = !!options.partial, this.nocase = !!this.options.nocase, this.windowsNoMagicRoot = options.windowsNoMagicRoot === void 0 ? !!(this.isWindows && this.nocase) : options.windowsNoMagicRoot, this.globSet = [], this.globParts = [], this.set = [], this.make();
		}
		hasMagic() {
			if (this.options.magicalBraces && this.set.length > 1) return !0;
			for (let pattern of this.set) for (let part of pattern) if (typeof part != "string") return !0;
			return !1;
		}
		debug(..._) {}
		make() {
			let pattern = this.pattern, options = this.options;
			if (!options.nocomment && pattern.charAt(0) === "#") {
				this.comment = !0;
				return;
			}
			if (!pattern) {
				this.empty = !0;
				return;
			}
			this.parseNegate(), this.globSet = [...new Set(this.braceExpand())], options.debug && (this.debug = (...args) => console.error(...args)), this.debug(this.pattern, this.globSet);
			let rawGlobParts = this.globSet.map((s) => this.slashSplit(s));
			this.globParts = this.preprocess(rawGlobParts), this.debug(this.pattern, this.globParts);
			let set = this.globParts.map((s, _, __) => {
				if (this.isWindows && this.windowsNoMagicRoot) {
					let isUNC = s[0] === "" && s[1] === "" && (s[2] === "?" || !globMagic.test(s[2])) && !globMagic.test(s[3]), isDrive = /^[a-z]:/i.test(s[0]);
					if (isUNC) return [...s.slice(0, 4), ...s.slice(4).map((ss) => this.parse(ss))];
					if (isDrive) return [s[0], ...s.slice(1).map((ss) => this.parse(ss))];
				}
				return s.map((ss) => this.parse(ss));
			});
			if (this.debug(this.pattern, set), this.set = set.filter((s) => s.indexOf(!1) === -1), this.isWindows) for (let i = 0; i < this.set.length; i++) {
				let p = this.set[i];
				p[0] === "" && p[1] === "" && this.globParts[i][2] === "?" && typeof p[3] == "string" && /^[a-z]:$/i.test(p[3]) && (p[2] = "?");
			}
			this.debug(this.pattern, this.set);
		}
		preprocess(globParts) {
			if (this.options.noglobstar) for (let partset of globParts) for (let j = 0; j < partset.length; j++) partset[j] === "**" && (partset[j] = "*");
			let { optimizationLevel = 1 } = this.options;
			return optimizationLevel >= 2 ? (globParts = this.firstPhasePreProcess(globParts), globParts = this.secondPhasePreProcess(globParts)) : globParts = optimizationLevel >= 1 ? this.levelOneOptimize(globParts) : this.adjascentGlobstarOptimize(globParts), globParts;
		}
		adjascentGlobstarOptimize(globParts) {
			return globParts.map((parts) => {
				let gs = -1;
				for (; (gs = parts.indexOf("**", gs + 1)) !== -1;) {
					let i = gs;
					for (; parts[i + 1] === "**";) i++;
					i !== gs && parts.splice(gs, i - gs);
				}
				return parts;
			});
		}
		levelOneOptimize(globParts) {
			return globParts.map((parts) => (parts = parts.reduce((set, part) => {
				let prev = set[set.length - 1];
				return part === "**" && prev === "**" ? set : part === ".." && prev && prev !== ".." && prev !== "." && prev !== "**" ? (set.pop(), set) : (set.push(part), set);
			}, []), parts.length === 0 ? [""] : parts));
		}
		levelTwoFileOptimize(parts) {
			Array.isArray(parts) || (parts = this.slashSplit(parts));
			let didSomething = !1;
			do {
				if (didSomething = !1, !this.preserveMultipleSlashes) {
					for (let i = 1; i < parts.length - 1; i++) {
						let p = parts[i];
						(i !== 1 || p !== "" || parts[0] !== "") && (p === "." || p === "") && (didSomething = !0, parts.splice(i, 1), i--);
					}
					parts[0] === "." && parts.length === 2 && (parts[1] === "." || parts[1] === "") && (didSomething = !0, parts.pop());
				}
				let dd = 0;
				for (; (dd = parts.indexOf("..", dd + 1)) !== -1;) {
					let p = parts[dd - 1];
					p && p !== "." && p !== ".." && p !== "**" && !(this.isWindows && /^[a-z]:$/i.test(p)) && (didSomething = !0, parts.splice(dd - 1, 2), dd -= 2);
				}
			} while (didSomething);
			return parts.length === 0 ? [""] : parts;
		}
		firstPhasePreProcess(globParts) {
			let didSomething = !1;
			do {
				didSomething = !1;
				for (let parts of globParts) {
					let gs = -1;
					for (; (gs = parts.indexOf("**", gs + 1)) !== -1;) {
						let gss = gs;
						for (; parts[gss + 1] === "**";) gss++;
						gss > gs && parts.splice(gs + 1, gss - gs);
						let next = parts[gs + 1], p = parts[gs + 2], p2 = parts[gs + 3];
						if (next !== ".." || !p || p === "." || p === ".." || !p2 || p2 === "." || p2 === "..") continue;
						didSomething = !0, parts.splice(gs, 1);
						let other = parts.slice(0);
						other[gs] = "**", globParts.push(other), gs--;
					}
					if (!this.preserveMultipleSlashes) {
						for (let i = 1; i < parts.length - 1; i++) {
							let p = parts[i];
							(i !== 1 || p !== "" || parts[0] !== "") && (p === "." || p === "") && (didSomething = !0, parts.splice(i, 1), i--);
						}
						parts[0] === "." && parts.length === 2 && (parts[1] === "." || parts[1] === "") && (didSomething = !0, parts.pop());
					}
					let dd = 0;
					for (; (dd = parts.indexOf("..", dd + 1)) !== -1;) {
						let p = parts[dd - 1];
						if (p && p !== "." && p !== ".." && p !== "**") {
							didSomething = !0;
							let splin = dd === 1 && parts[dd + 1] === "**" ? ["."] : [];
							parts.splice(dd - 1, 2, ...splin), parts.length === 0 && parts.push(""), dd -= 2;
						}
					}
				}
			} while (didSomething);
			return globParts;
		}
		secondPhasePreProcess(globParts) {
			for (let i = 0; i < globParts.length - 1; i++) for (let j = i + 1; j < globParts.length; j++) {
				let matched = this.partsMatch(globParts[i], globParts[j], !this.preserveMultipleSlashes);
				if (matched) {
					globParts[i] = [], globParts[j] = matched;
					break;
				}
			}
			return globParts.filter((gs) => gs.length);
		}
		partsMatch(a, b, emptyGSMatch = !1) {
			let ai = 0, bi = 0, result = [], which = "";
			for (; ai < a.length && bi < b.length;) if (a[ai] === b[bi]) result.push(which === "b" ? b[bi] : a[ai]), ai++, bi++;
			else if (emptyGSMatch && a[ai] === "**" && b[bi] === a[ai + 1]) result.push(a[ai]), ai++;
			else if (emptyGSMatch && b[bi] === "**" && a[ai] === b[bi + 1]) result.push(b[bi]), bi++;
			else if (a[ai] === "*" && b[bi] && (this.options.dot || !b[bi].startsWith(".")) && b[bi] !== "**") {
				if (which === "b") return !1;
				which = "a", result.push(a[ai]), ai++, bi++;
			} else if (b[bi] === "*" && a[ai] && (this.options.dot || !a[ai].startsWith(".")) && a[ai] !== "**") {
				if (which === "a") return !1;
				which = "b", result.push(b[bi]), ai++, bi++;
			} else return !1;
			return a.length === b.length && result;
		}
		parseNegate() {
			if (this.nonegate) return;
			let pattern = this.pattern, negate = !1, negateOffset = 0;
			for (let i = 0; i < pattern.length && pattern.charAt(i) === "!"; i++) negate = !negate, negateOffset++;
			negateOffset && (this.pattern = pattern.slice(negateOffset)), this.negate = negate;
		}
		matchOne(file, pattern, partial = !1) {
			let fileStartIndex = 0, patternStartIndex = 0;
			if (this.isWindows) {
				let fileDrive = typeof file[0] == "string" && /^[a-z]:$/i.test(file[0]), fileUNC = !fileDrive && file[0] === "" && file[1] === "" && file[2] === "?" && /^[a-z]:$/i.test(file[3]), patternDrive = typeof pattern[0] == "string" && /^[a-z]:$/i.test(pattern[0]), patternUNC = !patternDrive && pattern[0] === "" && pattern[1] === "" && pattern[2] === "?" && typeof pattern[3] == "string" && /^[a-z]:$/i.test(pattern[3]), fdi = fileUNC ? 3 : fileDrive ? 0 : void 0, pdi = patternUNC ? 3 : patternDrive ? 0 : void 0;
				if (typeof fdi == "number" && typeof pdi == "number") {
					let [fd, pd] = [file[fdi], pattern[pdi]];
					fd.toLowerCase() === pd.toLowerCase() && (pattern[pdi] = fd, patternStartIndex = pdi, fileStartIndex = fdi);
				}
			}
			let { optimizationLevel = 1 } = this.options;
			return optimizationLevel >= 2 && (file = this.levelTwoFileOptimize(file)), pattern.includes(exports.GLOBSTAR) ? this.#matchGlobstar(file, pattern, partial, fileStartIndex, patternStartIndex) : this.#matchOne(file, pattern, partial, fileStartIndex, patternStartIndex);
		}
		#matchGlobstar(file, pattern, partial, fileIndex, patternIndex) {
			let firstgs = pattern.indexOf(exports.GLOBSTAR, patternIndex), lastgs = pattern.lastIndexOf(exports.GLOBSTAR), [head, body, tail] = partial ? [
				pattern.slice(patternIndex, firstgs),
				pattern.slice(firstgs + 1),
				[]
			] : [
				pattern.slice(patternIndex, firstgs),
				pattern.slice(firstgs + 1, lastgs),
				pattern.slice(lastgs + 1)
			];
			if (head.length) {
				let fileHead = file.slice(fileIndex, fileIndex + head.length);
				if (!this.#matchOne(fileHead, head, partial, 0, 0)) return !1;
				fileIndex += head.length, patternIndex += head.length;
			}
			let fileTailMatch = 0;
			if (tail.length) {
				if (tail.length + fileIndex > file.length) return !1;
				let tailStart = file.length - tail.length;
				if (this.#matchOne(file, tail, partial, tailStart, 0)) fileTailMatch = tail.length;
				else {
					if (file[file.length - 1] !== "" || fileIndex + tail.length === file.length || (tailStart--, !this.#matchOne(file, tail, partial, tailStart, 0))) return !1;
					fileTailMatch = tail.length + 1;
				}
			}
			if (!body.length) {
				let sawSome = !!fileTailMatch;
				for (let i = fileIndex; i < file.length - fileTailMatch; i++) {
					let f = String(file[i]);
					if (sawSome = !0, f === "." || f === ".." || !this.options.dot && f.startsWith(".")) return !1;
				}
				return partial || sawSome;
			}
			let bodySegments = [[[], 0]], currentBody = bodySegments[0], nonGsParts = 0, nonGsPartsSums = [0];
			for (let b of body) b === exports.GLOBSTAR ? (nonGsPartsSums.push(nonGsParts), currentBody = [[], 0], bodySegments.push(currentBody)) : (currentBody[0].push(b), nonGsParts++);
			let i = bodySegments.length - 1, fileLength = file.length - fileTailMatch;
			for (let b of bodySegments) b[1] = fileLength - (nonGsPartsSums[i--] + b[0].length);
			return !!this.#matchGlobStarBodySections(file, bodySegments, fileIndex, 0, partial, 0, !!fileTailMatch);
		}
		#matchGlobStarBodySections(file, bodySegments, fileIndex, bodyIndex, partial, globStarDepth, sawTail) {
			let bs = bodySegments[bodyIndex];
			if (!bs) {
				for (let i = fileIndex; i < file.length; i++) {
					sawTail = !0;
					let f = file[i];
					if (f === "." || f === ".." || !this.options.dot && f.startsWith(".")) return !1;
				}
				return sawTail;
			}
			let [body, after] = bs;
			for (; fileIndex <= after;) {
				if (this.#matchOne(file.slice(0, fileIndex + body.length), body, partial, fileIndex, 0) && globStarDepth < this.maxGlobstarRecursion) {
					let sub = this.#matchGlobStarBodySections(file, bodySegments, fileIndex + body.length, bodyIndex + 1, partial, globStarDepth + 1, sawTail);
					if (sub !== !1) return sub;
				}
				let f = file[fileIndex];
				if (f === "." || f === ".." || !this.options.dot && f.startsWith(".")) return !1;
				fileIndex++;
			}
			return partial || null;
		}
		#matchOne(file, pattern, partial, fileIndex, patternIndex) {
			let fi, pi, pl, fl;
			for (fi = fileIndex, pi = patternIndex, fl = file.length, pl = pattern.length; fi < fl && pi < pl; fi++, pi++) {
				this.debug("matchOne loop");
				let p = pattern[pi], f = file[fi];
				if (this.debug(pattern, p, f), p === !1 || p === exports.GLOBSTAR) return !1;
				let hit;
				if (typeof p == "string" ? (hit = f === p, this.debug("string match", p, f, hit)) : (hit = p.test(f), this.debug("pattern match", p, f, hit)), !hit) return !1;
			}
			if (fi === fl && pi === pl) return !0;
			if (fi === fl) return partial;
			if (pi === pl) return fi === fl - 1 && file[fi] === "";
			throw Error("wtf?");
		}
		braceExpand() {
			return (0, exports.braceExpand)(this.pattern, this.options);
		}
		parse(pattern) {
			(0, assert_valid_pattern_js_1.assertValidPattern)(pattern);
			let options = this.options;
			if (pattern === "**") return exports.GLOBSTAR;
			if (pattern === "") return "";
			let m, fastTest = null;
			(m = pattern.match(starRE)) ? fastTest = options.dot ? starTestDot : starTest : (m = pattern.match(starDotExtRE)) ? fastTest = (options.nocase ? options.dot ? starDotExtTestNocaseDot : starDotExtTestNocase : options.dot ? starDotExtTestDot : starDotExtTest)(m[1]) : (m = pattern.match(qmarksRE)) ? fastTest = (options.nocase ? options.dot ? qmarksTestNocaseDot : qmarksTestNocase : options.dot ? qmarksTestDot : qmarksTest)(m) : (m = pattern.match(starDotStarRE)) ? fastTest = options.dot ? starDotStarTestDot : starDotStarTest : (m = pattern.match(dotStarRE)) && (fastTest = dotStarTest);
			let re = ast_js_1.AST.fromGlob(pattern, this.options).toMMPattern();
			return fastTest && typeof re == "object" && Reflect.defineProperty(re, "test", { value: fastTest }), re;
		}
		makeRe() {
			if (this.regexp || this.regexp === !1) return this.regexp;
			let set = this.set;
			if (!set.length) return this.regexp = !1, this.regexp;
			let options = this.options, twoStar = options.noglobstar ? "[^/]*?" : options.dot ? "(?:(?!(?:\\/|^)(?:\\.{1,2})($|\\/)).)*?" : "(?:(?!(?:\\/|^)\\.).)*?", flags = new Set(options.nocase ? ["i"] : []), re = set.map((pattern) => {
				let pp = pattern.map((p) => {
					if (p instanceof RegExp) for (let f of p.flags.split("")) flags.add(f);
					return typeof p == "string" ? regExpEscape(p) : p === exports.GLOBSTAR ? exports.GLOBSTAR : p._src;
				});
				pp.forEach((p, i) => {
					let next = pp[i + 1], prev = pp[i - 1];
					p === exports.GLOBSTAR && prev !== exports.GLOBSTAR && (prev === void 0 ? next !== void 0 && next !== exports.GLOBSTAR ? pp[i + 1] = "(?:\\/|" + twoStar + "\\/)?" + next : pp[i] = twoStar : next === void 0 ? pp[i - 1] = prev + "(?:\\/|\\/" + twoStar + ")?" : next !== exports.GLOBSTAR && (pp[i - 1] = prev + "(?:\\/|\\/" + twoStar + "\\/)" + next, pp[i + 1] = exports.GLOBSTAR));
				});
				let filtered = pp.filter((p) => p !== exports.GLOBSTAR);
				if (this.partial && filtered.length >= 1) {
					let prefixes = [];
					for (let i = 1; i <= filtered.length; i++) prefixes.push(filtered.slice(0, i).join("/"));
					return "(?:" + prefixes.join("|") + ")";
				}
				return filtered.join("/");
			}).join("|"), [open, close] = set.length > 1 ? ["(?:", ")"] : ["", ""];
			re = "^" + open + re + close + "$", this.partial && (re = "^(?:\\/|" + open + re.slice(1, -1) + close + ")$"), this.negate && (re = "^(?!" + re + ").+$");
			try {
				this.regexp = new RegExp(re, [...flags].join(""));
			} catch {
				this.regexp = !1;
			}
			return this.regexp;
		}
		slashSplit(p) {
			return this.preserveMultipleSlashes ? p.split("/") : this.isWindows && /^\/\/[^/]+/.test(p) ? ["", ...p.split(/\/+/)] : p.split(/\/+/);
		}
		match(f, partial = this.partial) {
			if (this.debug("match", f, this.pattern), this.comment) return !1;
			if (this.empty) return f === "";
			if (f === "/" && partial) return !0;
			let options = this.options;
			this.isWindows && (f = f.split("\\").join("/"));
			let ff = this.slashSplit(f);
			this.debug(this.pattern, "split", ff);
			let set = this.set;
			this.debug(this.pattern, "set", set);
			let filename = ff[ff.length - 1];
			if (!filename) for (let i = ff.length - 2; !filename && i >= 0; i--) filename = ff[i];
			for (let pattern of set) {
				let file = ff;
				if (options.matchBase && pattern.length === 1 && (file = [filename]), this.matchOne(file, pattern, partial)) return options.flipNegate ? !0 : !this.negate;
			}
			return !options.flipNegate && this.negate;
		}
		static defaults(def) {
			return exports.minimatch.defaults(def).Minimatch;
		}
	};
	exports.Minimatch = Minimatch;
	var ast_js_2 = require_ast();
	Object.defineProperty(exports, "AST", {
		enumerable: !0,
		get: function() {
			return ast_js_2.AST;
		}
	});
	var escape_js_2 = require_escape();
	Object.defineProperty(exports, "escape", {
		enumerable: !0,
		get: function() {
			return escape_js_2.escape;
		}
	});
	var unescape_js_2 = require_unescape();
	Object.defineProperty(exports, "unescape", {
		enumerable: !0,
		get: function() {
			return unescape_js_2.unescape;
		}
	}), exports.minimatch.AST = ast_js_1.AST, exports.minimatch.Minimatch = Minimatch, exports.minimatch.escape = escape_js_1.escape, exports.minimatch.unescape = unescape_js_1.unescape;
})), require_role = __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.SuccinctRoles = exports.DelegatedRole = exports.Role = exports.TOP_LEVEL_ROLE_NAMES = void 0;
	let crypto_1$1 = __importDefault(require("crypto")), minimatch_1 = require_commonjs(), util_1$7 = __importDefault(require("util")), error_1 = require_error$5(), utils_1 = require_utils();
	exports.TOP_LEVEL_ROLE_NAMES = [
		"root",
		"targets",
		"snapshot",
		"timestamp"
	];
	var Role = class Role {
		keyIDs;
		threshold;
		unrecognizedFields;
		constructor(options) {
			let { keyIDs, threshold, unrecognizedFields } = options;
			if (hasDuplicates(keyIDs)) throw new error_1.ValueError("duplicate key IDs found");
			if (threshold < 1) throw new error_1.ValueError("threshold must be at least 1");
			this.keyIDs = keyIDs, this.threshold = threshold, this.unrecognizedFields = unrecognizedFields || {};
		}
		equals(other) {
			return other instanceof Role && this.threshold === other.threshold && util_1$7.default.isDeepStrictEqual(this.keyIDs, other.keyIDs) && util_1$7.default.isDeepStrictEqual(this.unrecognizedFields, other.unrecognizedFields);
		}
		toJSON() {
			return {
				keyids: this.keyIDs,
				threshold: this.threshold,
				...this.unrecognizedFields
			};
		}
		static fromJSON(data) {
			let { keyids, threshold, ...rest } = data;
			if (!utils_1.guard.isStringArray(keyids)) throw TypeError("keyids must be an array");
			if (typeof threshold != "number") throw TypeError("threshold must be a number");
			return new Role({
				keyIDs: keyids,
				threshold,
				unrecognizedFields: rest
			});
		}
	};
	exports.Role = Role;
	function hasDuplicates(array) {
		return new Set(array).size !== array.length;
	}
	exports.DelegatedRole = class DelegatedRole extends Role {
		name;
		terminating;
		paths;
		pathHashPrefixes;
		constructor(opts) {
			super(opts);
			let { name, terminating, paths, pathHashPrefixes } = opts;
			if (this.name = name, this.terminating = terminating, opts.paths && opts.pathHashPrefixes) throw new error_1.ValueError("paths and pathHashPrefixes are mutually exclusive");
			this.paths = paths, this.pathHashPrefixes = pathHashPrefixes;
		}
		equals(other) {
			return other instanceof DelegatedRole && super.equals(other) && this.name === other.name && this.terminating === other.terminating && util_1$7.default.isDeepStrictEqual(this.paths, other.paths) && util_1$7.default.isDeepStrictEqual(this.pathHashPrefixes, other.pathHashPrefixes);
		}
		isDelegatedPath(targetFilepath) {
			if (this.paths) return this.paths.some((pathPattern) => isTargetInPathPattern(targetFilepath, pathPattern));
			if (this.pathHashPrefixes) {
				let pathHash = crypto_1$1.default.createHash("sha256").update(targetFilepath).digest("hex");
				return this.pathHashPrefixes.some((pathHashPrefix) => pathHash.startsWith(pathHashPrefix));
			}
			return !1;
		}
		toJSON() {
			let json = {
				...super.toJSON(),
				name: this.name,
				terminating: this.terminating
			};
			return this.paths && (json.paths = this.paths), this.pathHashPrefixes && (json.path_hash_prefixes = this.pathHashPrefixes), json;
		}
		static fromJSON(data) {
			let { keyids, threshold, name, terminating, paths, path_hash_prefixes, ...rest } = data;
			if (!utils_1.guard.isStringArray(keyids)) throw TypeError("keyids must be an array of strings");
			if (typeof threshold != "number") throw TypeError("threshold must be a number");
			if (typeof name != "string") throw TypeError("name must be a string");
			if (typeof terminating != "boolean") throw TypeError("terminating must be a boolean");
			if (utils_1.guard.isDefined(paths) && !utils_1.guard.isStringArray(paths)) throw TypeError("paths must be an array of strings");
			if (utils_1.guard.isDefined(path_hash_prefixes) && !utils_1.guard.isStringArray(path_hash_prefixes)) throw TypeError("path_hash_prefixes must be an array of strings");
			return new DelegatedRole({
				keyIDs: keyids,
				threshold,
				name,
				terminating,
				paths,
				pathHashPrefixes: path_hash_prefixes,
				unrecognizedFields: rest
			});
		}
	};
	let zip = (a, b) => a.map((k, i) => [k, b[i]]);
	function isTargetInPathPattern(target, pattern) {
		let targetParts = target.split("/"), patternParts = pattern.split("/");
		return patternParts.length == targetParts.length && zip(targetParts, patternParts).every(([targetPart, patternPart]) => (0, minimatch_1.minimatch)(targetPart, patternPart));
	}
	exports.SuccinctRoles = class SuccinctRoles extends Role {
		bitLength;
		namePrefix;
		numberOfBins;
		suffixLen;
		constructor(opts) {
			super(opts);
			let { bitLength, namePrefix } = opts;
			if (bitLength <= 0 || bitLength > 32) throw new error_1.ValueError("bitLength must be between 1 and 32");
			this.bitLength = bitLength, this.namePrefix = namePrefix, this.numberOfBins = 2 ** bitLength, this.suffixLen = (this.numberOfBins - 1).toString(16).length;
		}
		equals(other) {
			return other instanceof SuccinctRoles && super.equals(other) && this.bitLength === other.bitLength && this.namePrefix === other.namePrefix;
		}
		getRoleForTarget(targetFilepath) {
			let hashBytes = crypto_1$1.default.createHash("sha256").update(targetFilepath).digest().subarray(0, 4), shiftValue = 32 - this.bitLength, suffix = (hashBytes.readUInt32BE() >>> shiftValue).toString(16).padStart(this.suffixLen, "0");
			return `${this.namePrefix}-${suffix}`;
		}
		*getRoles() {
			for (let i = 0; i < this.numberOfBins; i++) {
				let suffix = i.toString(16).padStart(this.suffixLen, "0");
				yield `${this.namePrefix}-${suffix}`;
			}
		}
		isDelegatedRole(roleName) {
			let desiredPrefix = this.namePrefix + "-";
			if (!roleName.startsWith(desiredPrefix)) return !1;
			let suffix = roleName.slice(desiredPrefix.length, roleName.length);
			if (suffix.length != this.suffixLen || !suffix.match(/^[0-9a-fA-F]+$/)) return !1;
			let num = parseInt(suffix, 16);
			return 0 <= num && num < this.numberOfBins;
		}
		toJSON() {
			return {
				...super.toJSON(),
				bit_length: this.bitLength,
				name_prefix: this.namePrefix
			};
		}
		static fromJSON(data) {
			let { keyids, threshold, bit_length, name_prefix, ...rest } = data;
			if (!utils_1.guard.isStringArray(keyids)) throw TypeError("keyids must be an array of strings");
			if (typeof threshold != "number") throw TypeError("threshold must be a number");
			if (typeof bit_length != "number") throw TypeError("bit_length must be a number");
			if (typeof name_prefix != "string") throw TypeError("name_prefix must be a string");
			return new SuccinctRoles({
				keyIDs: keyids,
				threshold,
				bitLength: bit_length,
				namePrefix: name_prefix,
				unrecognizedFields: rest
			});
		}
	};
})), require_root = __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Root = void 0;
	let util_1$6 = __importDefault(require("util")), base_1 = require_base(), error_1 = require_error$5(), key_1 = require_key$1(), role_1 = require_role(), utils_1 = require_utils();
	exports.Root = class Root extends base_1.Signed {
		type = base_1.MetadataKind.Root;
		keys;
		roles;
		consistentSnapshot;
		constructor(options) {
			if (super(options), this.keys = options.keys || {}, this.consistentSnapshot = options.consistentSnapshot ?? !0, !options.roles) this.roles = role_1.TOP_LEVEL_ROLE_NAMES.reduce((acc, role) => ({
				...acc,
				[role]: new role_1.Role({
					keyIDs: [],
					threshold: 1
				})
			}), {});
			else {
				let roleNames = new Set(Object.keys(options.roles));
				if (!role_1.TOP_LEVEL_ROLE_NAMES.every((role) => roleNames.has(role))) throw new error_1.ValueError("missing top-level role");
				this.roles = options.roles;
			}
		}
		addKey(key, role) {
			if (!this.roles[role]) throw new error_1.ValueError(`role ${role} does not exist`);
			this.roles[role].keyIDs.includes(key.keyID) || this.roles[role].keyIDs.push(key.keyID), this.keys[key.keyID] = key;
		}
		equals(other) {
			return other instanceof Root && super.equals(other) && this.consistentSnapshot === other.consistentSnapshot && util_1$6.default.isDeepStrictEqual(this.keys, other.keys) && util_1$6.default.isDeepStrictEqual(this.roles, other.roles);
		}
		toJSON() {
			return {
				_type: this.type,
				spec_version: this.specVersion,
				version: this.version,
				expires: this.expires,
				keys: keysToJSON(this.keys),
				roles: rolesToJSON(this.roles),
				consistent_snapshot: this.consistentSnapshot,
				...this.unrecognizedFields
			};
		}
		static fromJSON(data) {
			let { unrecognizedFields, ...commonFields } = base_1.Signed.commonFieldsFromJSON(data), { keys, roles, consistent_snapshot, ...rest } = unrecognizedFields;
			if (typeof consistent_snapshot != "boolean") throw TypeError("consistent_snapshot must be a boolean");
			return new Root({
				...commonFields,
				keys: keysFromJSON(keys),
				roles: rolesFromJSON(roles),
				consistentSnapshot: consistent_snapshot,
				unrecognizedFields: rest
			});
		}
	};
	function keysToJSON(keys) {
		return Object.entries(keys).reduce((acc, [keyID, key]) => ({
			...acc,
			[keyID]: key.toJSON()
		}), {});
	}
	function rolesToJSON(roles) {
		return Object.entries(roles).reduce((acc, [roleName, role]) => ({
			...acc,
			[roleName]: role.toJSON()
		}), {});
	}
	function keysFromJSON(data) {
		let keys;
		if (utils_1.guard.isDefined(data)) {
			if (!utils_1.guard.isObjectRecord(data)) throw TypeError("keys must be an object");
			keys = Object.entries(data).reduce((acc, [keyID, keyData]) => ({
				...acc,
				[keyID]: key_1.Key.fromJSON(keyID, keyData)
			}), {});
		}
		return keys;
	}
	function rolesFromJSON(data) {
		let roles;
		if (utils_1.guard.isDefined(data)) {
			if (!utils_1.guard.isObjectRecord(data)) throw TypeError("roles must be an object");
			roles = Object.entries(data).reduce((acc, [roleName, roleData]) => ({
				...acc,
				[roleName]: role_1.Role.fromJSON(roleData)
			}), {});
		}
		return roles;
	}
})), require_signature = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Signature = void 0, exports.Signature = class Signature {
		keyID;
		sig;
		constructor(options) {
			let { keyID, sig } = options;
			this.keyID = keyID, this.sig = sig;
		}
		toJSON() {
			return {
				keyid: this.keyID,
				sig: this.sig
			};
		}
		static fromJSON(data) {
			let { keyid, sig } = data;
			if (typeof keyid != "string") throw TypeError("keyid must be a string");
			if (typeof sig != "string") throw TypeError("sig must be a string");
			return new Signature({
				keyID: keyid,
				sig
			});
		}
	};
})), require_snapshot = __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Snapshot = void 0;
	let util_1$5 = __importDefault(require("util")), base_1 = require_base(), file_1 = require_file(), utils_1 = require_utils();
	exports.Snapshot = class Snapshot extends base_1.Signed {
		type = base_1.MetadataKind.Snapshot;
		meta;
		constructor(opts) {
			super(opts), this.meta = opts.meta || { "targets.json": new file_1.MetaFile({ version: 1 }) };
		}
		equals(other) {
			return other instanceof Snapshot && super.equals(other) && util_1$5.default.isDeepStrictEqual(this.meta, other.meta);
		}
		toJSON() {
			return {
				_type: this.type,
				meta: metaToJSON(this.meta),
				spec_version: this.specVersion,
				version: this.version,
				expires: this.expires,
				...this.unrecognizedFields
			};
		}
		static fromJSON(data) {
			let { unrecognizedFields, ...commonFields } = base_1.Signed.commonFieldsFromJSON(data), { meta, ...rest } = unrecognizedFields;
			return new Snapshot({
				...commonFields,
				meta: metaFromJSON(meta),
				unrecognizedFields: rest
			});
		}
	};
	function metaToJSON(meta) {
		return Object.entries(meta).reduce((acc, [path, metadata]) => ({
			...acc,
			[path]: metadata.toJSON()
		}), {});
	}
	function metaFromJSON(data) {
		let meta;
		if (utils_1.guard.isDefined(data)) {
			if (utils_1.guard.isObjectRecord(data)) meta = Object.entries(data).reduce((acc, [path, metadata]) => ({
				...acc,
				[path]: file_1.MetaFile.fromJSON(metadata)
			}), {});
			else throw TypeError("meta field is malformed");
		}
		return meta;
	}
})), require_delegations = __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Delegations = void 0;
	let util_1$4 = __importDefault(require("util")), error_1 = require_error$5(), key_1 = require_key$1(), role_1 = require_role(), utils_1 = require_utils();
	exports.Delegations = class Delegations {
		keys;
		roles;
		unrecognizedFields;
		succinctRoles;
		constructor(options) {
			if (this.keys = options.keys, this.unrecognizedFields = options.unrecognizedFields || {}, options.roles && Object.keys(options.roles).some((roleName) => role_1.TOP_LEVEL_ROLE_NAMES.includes(roleName))) throw new error_1.ValueError("Delegated role name conflicts with top-level role name");
			this.succinctRoles = options.succinctRoles, this.roles = options.roles;
		}
		equals(other) {
			return other instanceof Delegations && util_1$4.default.isDeepStrictEqual(this.keys, other.keys) && util_1$4.default.isDeepStrictEqual(this.roles, other.roles) && util_1$4.default.isDeepStrictEqual(this.unrecognizedFields, other.unrecognizedFields) && util_1$4.default.isDeepStrictEqual(this.succinctRoles, other.succinctRoles);
		}
		*rolesForTarget(targetPath) {
			if (this.roles) for (let role of Object.values(this.roles)) role.isDelegatedPath(targetPath) && (yield {
				role: role.name,
				terminating: role.terminating
			});
			else this.succinctRoles && (yield {
				role: this.succinctRoles.getRoleForTarget(targetPath),
				terminating: !0
			});
		}
		toJSON() {
			let json = {
				keys: keysToJSON(this.keys),
				...this.unrecognizedFields
			};
			return this.roles ? json.roles = rolesToJSON(this.roles) : this.succinctRoles && (json.succinct_roles = this.succinctRoles.toJSON()), json;
		}
		static fromJSON(data) {
			let { keys, roles, succinct_roles, ...unrecognizedFields } = data, succinctRoles;
			return utils_1.guard.isObject(succinct_roles) && (succinctRoles = role_1.SuccinctRoles.fromJSON(succinct_roles)), new Delegations({
				keys: keysFromJSON(keys),
				roles: rolesFromJSON(roles),
				unrecognizedFields,
				succinctRoles
			});
		}
	};
	function keysToJSON(keys) {
		return Object.entries(keys).reduce((acc, [keyId, key]) => ({
			...acc,
			[keyId]: key.toJSON()
		}), {});
	}
	function rolesToJSON(roles) {
		return Object.values(roles).map((role) => role.toJSON());
	}
	function keysFromJSON(data) {
		if (!utils_1.guard.isObjectRecord(data)) throw TypeError("keys is malformed");
		return Object.entries(data).reduce((acc, [keyID, keyData]) => ({
			...acc,
			[keyID]: key_1.Key.fromJSON(keyID, keyData)
		}), {});
	}
	function rolesFromJSON(data) {
		let roleMap;
		if (utils_1.guard.isDefined(data)) {
			if (!utils_1.guard.isObjectArray(data)) throw TypeError("roles is malformed");
			roleMap = data.reduce((acc, role) => {
				let delegatedRole = role_1.DelegatedRole.fromJSON(role);
				return {
					...acc,
					[delegatedRole.name]: delegatedRole
				};
			}, {});
		}
		return roleMap;
	}
})), require_targets = __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Targets = void 0;
	let util_1$3 = __importDefault(require("util")), base_1 = require_base(), delegations_1 = require_delegations(), file_1 = require_file(), utils_1 = require_utils();
	exports.Targets = class Targets extends base_1.Signed {
		type = base_1.MetadataKind.Targets;
		targets;
		delegations;
		constructor(options) {
			super(options), this.targets = options.targets || {}, this.delegations = options.delegations;
		}
		addTarget(target) {
			this.targets[target.path] = target;
		}
		equals(other) {
			return other instanceof Targets && super.equals(other) && util_1$3.default.isDeepStrictEqual(this.targets, other.targets) && util_1$3.default.isDeepStrictEqual(this.delegations, other.delegations);
		}
		toJSON() {
			let json = {
				_type: this.type,
				spec_version: this.specVersion,
				version: this.version,
				expires: this.expires,
				targets: targetsToJSON(this.targets),
				...this.unrecognizedFields
			};
			return this.delegations && (json.delegations = this.delegations.toJSON()), json;
		}
		static fromJSON(data) {
			let { unrecognizedFields, ...commonFields } = base_1.Signed.commonFieldsFromJSON(data), { targets, delegations, ...rest } = unrecognizedFields;
			return new Targets({
				...commonFields,
				targets: targetsFromJSON(targets),
				delegations: delegationsFromJSON(delegations),
				unrecognizedFields: rest
			});
		}
	};
	function targetsToJSON(targets) {
		return Object.entries(targets).reduce((acc, [path, target]) => ({
			...acc,
			[path]: target.toJSON()
		}), {});
	}
	function targetsFromJSON(data) {
		let targets;
		if (utils_1.guard.isDefined(data)) {
			if (utils_1.guard.isObjectRecord(data)) targets = Object.entries(data).reduce((acc, [path, target]) => ({
				...acc,
				[path]: file_1.TargetFile.fromJSON(path, target)
			}), {});
			else throw TypeError("targets must be an object");
		}
		return targets;
	}
	function delegationsFromJSON(data) {
		let delegations;
		if (utils_1.guard.isDefined(data)) {
			if (utils_1.guard.isObject(data)) delegations = delegations_1.Delegations.fromJSON(data);
			else throw TypeError("delegations must be an object");
		}
		return delegations;
	}
})), require_timestamp$2 = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Timestamp = void 0;
	let base_1 = require_base(), file_1 = require_file(), utils_1 = require_utils();
	exports.Timestamp = class Timestamp extends base_1.Signed {
		type = base_1.MetadataKind.Timestamp;
		snapshotMeta;
		constructor(options) {
			super(options), this.snapshotMeta = options.snapshotMeta || new file_1.MetaFile({ version: 1 });
		}
		equals(other) {
			return other instanceof Timestamp && super.equals(other) && this.snapshotMeta.equals(other.snapshotMeta);
		}
		toJSON() {
			return {
				_type: this.type,
				spec_version: this.specVersion,
				version: this.version,
				expires: this.expires,
				meta: { "snapshot.json": this.snapshotMeta.toJSON() },
				...this.unrecognizedFields
			};
		}
		static fromJSON(data) {
			let { unrecognizedFields, ...commonFields } = base_1.Signed.commonFieldsFromJSON(data), { meta, ...rest } = unrecognizedFields;
			return new Timestamp({
				...commonFields,
				snapshotMeta: snapshotMetaFromJSON(meta),
				unrecognizedFields: rest
			});
		}
	};
	function snapshotMetaFromJSON(data) {
		let snapshotMeta;
		if (utils_1.guard.isDefined(data)) {
			let snapshotData = data["snapshot.json"];
			if (!utils_1.guard.isDefined(snapshotData) || !utils_1.guard.isObject(snapshotData)) throw TypeError("missing snapshot.json in meta");
			snapshotMeta = file_1.MetaFile.fromJSON(snapshotData);
		}
		return snapshotMeta;
	}
})), require_metadata = __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Metadata = void 0;
	let canonical_json_1 = require_lib$1(), util_1$2 = __importDefault(require("util")), base_1 = require_base(), error_1 = require_error$5(), root_1 = require_root(), signature_1 = require_signature(), snapshot_1 = require_snapshot(), targets_1 = require_targets(), timestamp_1 = require_timestamp$2(), utils_1 = require_utils();
	exports.Metadata = class Metadata {
		signed;
		signatures;
		unrecognizedFields;
		constructor(signed, signatures, unrecognizedFields) {
			this.signed = signed, this.signatures = signatures || {}, this.unrecognizedFields = unrecognizedFields || {};
		}
		sign(signer, append = !0) {
			let signature = signer(Buffer.from((0, canonical_json_1.canonicalize)(this.signed.toJSON())));
			append || (this.signatures = {}), this.signatures[signature.keyID] = signature;
		}
		verifyDelegate(delegatedRole, delegatedMetadata) {
			let role, keys = {};
			switch (this.signed.type) {
				case base_1.MetadataKind.Root:
					keys = this.signed.keys, role = this.signed.roles[delegatedRole];
					break;
				case base_1.MetadataKind.Targets:
					if (!this.signed.delegations) throw new error_1.ValueError(`No delegations found for ${delegatedRole}`);
					keys = this.signed.delegations.keys, this.signed.delegations.roles ? role = this.signed.delegations.roles[delegatedRole] : this.signed.delegations.succinctRoles && this.signed.delegations.succinctRoles.isDelegatedRole(delegatedRole) && (role = this.signed.delegations.succinctRoles);
					break;
				default: throw TypeError("invalid metadata type");
			}
			if (!role) throw new error_1.ValueError(`no delegation found for ${delegatedRole}`);
			let signingKeys = new Set();
			if (role.keyIDs.forEach((keyID) => {
				let key = keys[keyID];
				if (key) try {
					key.verifySignature(delegatedMetadata), signingKeys.add(key.keyID);
				} catch {}
			}), signingKeys.size < role.threshold) throw new error_1.UnsignedMetadataError(`${delegatedRole} was signed by ${signingKeys.size}/${role.threshold} keys`);
		}
		equals(other) {
			return other instanceof Metadata && this.signed.equals(other.signed) && util_1$2.default.isDeepStrictEqual(this.signatures, other.signatures) && util_1$2.default.isDeepStrictEqual(this.unrecognizedFields, other.unrecognizedFields);
		}
		toJSON() {
			return {
				signatures: Object.values(this.signatures).map((signature) => signature.toJSON()),
				signed: this.signed.toJSON(),
				...this.unrecognizedFields
			};
		}
		static fromJSON(type, data) {
			let { signed, signatures, ...rest } = data;
			if (!utils_1.guard.isDefined(signed) || !utils_1.guard.isObject(signed)) throw TypeError("signed is not defined");
			if (type !== signed._type) throw new error_1.ValueError(`expected '${type}', got ${signed._type}`);
			if (!utils_1.guard.isObjectArray(signatures)) throw TypeError("signatures is not an array");
			let signedObj;
			switch (type) {
				case base_1.MetadataKind.Root:
					signedObj = root_1.Root.fromJSON(signed);
					break;
				case base_1.MetadataKind.Timestamp:
					signedObj = timestamp_1.Timestamp.fromJSON(signed);
					break;
				case base_1.MetadataKind.Snapshot:
					signedObj = snapshot_1.Snapshot.fromJSON(signed);
					break;
				case base_1.MetadataKind.Targets:
					signedObj = targets_1.Targets.fromJSON(signed);
					break;
				default: throw TypeError("invalid metadata type");
			}
			let sigMap = {};
			return signatures.forEach((sigData) => {
				let sig = signature_1.Signature.fromJSON(sigData);
				if (sigMap[sig.keyID]) throw new error_1.ValueError(`multiple signatures found for keyid: ${sig.keyID}`);
				sigMap[sig.keyID] = sig;
			}), new Metadata(signedObj, sigMap, rest);
		}
	};
})), require_dist$4 = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Timestamp = exports.Targets = exports.Snapshot = exports.Signature = exports.Root = exports.Metadata = exports.Key = exports.TargetFile = exports.MetaFile = exports.ValueError = exports.MetadataKind = void 0;
	var base_1 = require_base();
	Object.defineProperty(exports, "MetadataKind", {
		enumerable: !0,
		get: function() {
			return base_1.MetadataKind;
		}
	});
	var error_1 = require_error$5();
	Object.defineProperty(exports, "ValueError", {
		enumerable: !0,
		get: function() {
			return error_1.ValueError;
		}
	});
	var file_1 = require_file();
	Object.defineProperty(exports, "MetaFile", {
		enumerable: !0,
		get: function() {
			return file_1.MetaFile;
		}
	}), Object.defineProperty(exports, "TargetFile", {
		enumerable: !0,
		get: function() {
			return file_1.TargetFile;
		}
	});
	var key_1 = require_key$1();
	Object.defineProperty(exports, "Key", {
		enumerable: !0,
		get: function() {
			return key_1.Key;
		}
	});
	var metadata_1 = require_metadata();
	Object.defineProperty(exports, "Metadata", {
		enumerable: !0,
		get: function() {
			return metadata_1.Metadata;
		}
	});
	var root_1 = require_root();
	Object.defineProperty(exports, "Root", {
		enumerable: !0,
		get: function() {
			return root_1.Root;
		}
	});
	var signature_1 = require_signature();
	Object.defineProperty(exports, "Signature", {
		enumerable: !0,
		get: function() {
			return signature_1.Signature;
		}
	});
	var snapshot_1 = require_snapshot();
	Object.defineProperty(exports, "Snapshot", {
		enumerable: !0,
		get: function() {
			return snapshot_1.Snapshot;
		}
	});
	var targets_1 = require_targets();
	Object.defineProperty(exports, "Targets", {
		enumerable: !0,
		get: function() {
			return targets_1.Targets;
		}
	});
	var timestamp_1 = require_timestamp$2();
	Object.defineProperty(exports, "Timestamp", {
		enumerable: !0,
		get: function() {
			return timestamp_1.Timestamp;
		}
	});
})), require_ms = __commonJSMin(((exports, module) => {
	var s = 1e3, m = s * 60, h = m * 60, d = h * 24, w = d * 7, y = d * 365.25;
	module.exports = function(val, options) {
		options ||= {};
		var type = typeof val;
		if (type === "string" && val.length > 0) return parse(val);
		if (type === "number" && isFinite(val)) return options.long ? fmtLong(val) : fmtShort(val);
		throw Error("val is not a non-empty string or a valid number. val=" + JSON.stringify(val));
	};
	function parse(str) {
		if (str = String(str), !(str.length > 100)) {
			var match = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(str);
			if (match) {
				var n = parseFloat(match[1]);
				switch ((match[2] || "ms").toLowerCase()) {
					case "years":
					case "year":
					case "yrs":
					case "yr":
					case "y": return n * y;
					case "weeks":
					case "week":
					case "w": return n * w;
					case "days":
					case "day":
					case "d": return n * d;
					case "hours":
					case "hour":
					case "hrs":
					case "hr":
					case "h": return n * h;
					case "minutes":
					case "minute":
					case "mins":
					case "min":
					case "m": return n * m;
					case "seconds":
					case "second":
					case "secs":
					case "sec":
					case "s": return n * s;
					case "milliseconds":
					case "millisecond":
					case "msecs":
					case "msec":
					case "ms": return n;
					default: return;
				}
			}
		}
	}
	function fmtShort(ms) {
		var msAbs = Math.abs(ms);
		return msAbs >= d ? Math.round(ms / d) + "d" : msAbs >= h ? Math.round(ms / h) + "h" : msAbs >= m ? Math.round(ms / m) + "m" : msAbs >= s ? Math.round(ms / s) + "s" : ms + "ms";
	}
	function fmtLong(ms) {
		var msAbs = Math.abs(ms);
		return msAbs >= d ? plural(ms, msAbs, d, "day") : msAbs >= h ? plural(ms, msAbs, h, "hour") : msAbs >= m ? plural(ms, msAbs, m, "minute") : msAbs >= s ? plural(ms, msAbs, s, "second") : ms + " ms";
	}
	function plural(ms, msAbs, n, name) {
		var isPlural = msAbs >= n * 1.5;
		return Math.round(ms / n) + " " + name + (isPlural ? "s" : "");
	}
})), require_common = __commonJSMin(((exports, module) => {
	function setup(env) {
		createDebug.debug = createDebug, createDebug.default = createDebug, createDebug.coerce = coerce, createDebug.disable = disable, createDebug.enable = enable, createDebug.enabled = enabled, createDebug.humanize = require_ms(), createDebug.destroy = destroy, Object.keys(env).forEach((key) => {
			createDebug[key] = env[key];
		}), createDebug.names = [], createDebug.skips = [], createDebug.formatters = {};
		function selectColor(namespace) {
			let hash = 0;
			for (let i = 0; i < namespace.length; i++) hash = (hash << 5) - hash + namespace.charCodeAt(i), hash |= 0;
			return createDebug.colors[Math.abs(hash) % createDebug.colors.length];
		}
		createDebug.selectColor = selectColor;
		function createDebug(namespace) {
			let prevTime, enableOverride = null, namespacesCache, enabledCache;
			function debug(...args) {
				if (!debug.enabled) return;
				let self = debug, curr = Number(new Date());
				self.diff = curr - (prevTime || curr), self.prev = prevTime, self.curr = curr, prevTime = curr, args[0] = createDebug.coerce(args[0]), typeof args[0] != "string" && args.unshift("%O");
				let index = 0;
				args[0] = args[0].replace(/%([a-zA-Z%])/g, (match, format) => {
					if (match === "%%") return "%";
					index++;
					let formatter = createDebug.formatters[format];
					if (typeof formatter == "function") {
						let val = args[index];
						match = formatter.call(self, val), args.splice(index, 1), index--;
					}
					return match;
				}), createDebug.formatArgs.call(self, args), (self.log || createDebug.log).apply(self, args);
			}
			return debug.namespace = namespace, debug.useColors = createDebug.useColors(), debug.color = createDebug.selectColor(namespace), debug.extend = extend, debug.destroy = createDebug.destroy, Object.defineProperty(debug, "enabled", {
				enumerable: !0,
				configurable: !1,
				get: () => enableOverride === null ? (namespacesCache !== createDebug.namespaces && (namespacesCache = createDebug.namespaces, enabledCache = createDebug.enabled(namespace)), enabledCache) : enableOverride,
				set: (v) => {
					enableOverride = v;
				}
			}), typeof createDebug.init == "function" && createDebug.init(debug), debug;
		}
		function extend(namespace, delimiter) {
			let newDebug = createDebug(this.namespace + (delimiter === void 0 ? ":" : delimiter) + namespace);
			return newDebug.log = this.log, newDebug;
		}
		function enable(namespaces) {
			createDebug.save(namespaces), createDebug.namespaces = namespaces, createDebug.names = [], createDebug.skips = [];
			let split = (typeof namespaces == "string" ? namespaces : "").trim().replace(/\s+/g, ",").split(",").filter(Boolean);
			for (let ns of split) ns[0] === "-" ? createDebug.skips.push(ns.slice(1)) : createDebug.names.push(ns);
		}
		function matchesTemplate(search, template) {
			let searchIndex = 0, templateIndex = 0, starIndex = -1, matchIndex = 0;
			for (; searchIndex < search.length;) if (templateIndex < template.length && (template[templateIndex] === search[searchIndex] || template[templateIndex] === "*")) template[templateIndex] === "*" ? (starIndex = templateIndex, matchIndex = searchIndex, templateIndex++) : (searchIndex++, templateIndex++);
			else if (starIndex !== -1) templateIndex = starIndex + 1, matchIndex++, searchIndex = matchIndex;
			else return !1;
			for (; templateIndex < template.length && template[templateIndex] === "*";) templateIndex++;
			return templateIndex === template.length;
		}
		function disable() {
			let namespaces = [...createDebug.names, ...createDebug.skips.map((namespace) => "-" + namespace)].join(",");
			return createDebug.enable(""), namespaces;
		}
		function enabled(name) {
			for (let skip of createDebug.skips) if (matchesTemplate(name, skip)) return !1;
			for (let ns of createDebug.names) if (matchesTemplate(name, ns)) return !0;
			return !1;
		}
		function coerce(val) {
			return val instanceof Error ? val.stack || val.message : val;
		}
		function destroy() {
			console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
		}
		return createDebug.enable(createDebug.load()), createDebug;
	}
	module.exports = setup;
})), require_browser = __commonJSMin(((exports, module) => {
	exports.formatArgs = formatArgs, exports.save = save, exports.load = load, exports.useColors = useColors, exports.storage = localstorage(), exports.destroy = (() => {
		let warned = !1;
		return () => {
			warned || (warned = !0, console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`."));
		};
	})(), exports.colors = "#0000CC.#0000FF.#0033CC.#0033FF.#0066CC.#0066FF.#0099CC.#0099FF.#00CC00.#00CC33.#00CC66.#00CC99.#00CCCC.#00CCFF.#3300CC.#3300FF.#3333CC.#3333FF.#3366CC.#3366FF.#3399CC.#3399FF.#33CC00.#33CC33.#33CC66.#33CC99.#33CCCC.#33CCFF.#6600CC.#6600FF.#6633CC.#6633FF.#66CC00.#66CC33.#9900CC.#9900FF.#9933CC.#9933FF.#99CC00.#99CC33.#CC0000.#CC0033.#CC0066.#CC0099.#CC00CC.#CC00FF.#CC3300.#CC3333.#CC3366.#CC3399.#CC33CC.#CC33FF.#CC6600.#CC6633.#CC9900.#CC9933.#CCCC00.#CCCC33.#FF0000.#FF0033.#FF0066.#FF0099.#FF00CC.#FF00FF.#FF3300.#FF3333.#FF3366.#FF3399.#FF33CC.#FF33FF.#FF6600.#FF6633.#FF9900.#FF9933.#FFCC00.#FFCC33".split(".");
	function useColors() {
		if (typeof window < "u" && window.process && (window.process.type === "renderer" || window.process.__nwjs)) return !0;
		if (typeof navigator < "u" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/(edge|trident)\/(\d+)/)) return !1;
		let m;
		return typeof document < "u" && document.documentElement && document.documentElement.style && document.documentElement.style.WebkitAppearance || typeof window < "u" && window.console && (window.console.firebug || window.console.exception && window.console.table) || typeof navigator < "u" && navigator.userAgent && (m = navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/)) && parseInt(m[1], 10) >= 31 || typeof navigator < "u" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/);
	}
	function formatArgs(args) {
		if (args[0] = (this.useColors ? "%c" : "") + this.namespace + (this.useColors ? " %c" : " ") + args[0] + (this.useColors ? "%c " : " ") + "+" + module.exports.humanize(this.diff), !this.useColors) return;
		let c = "color: " + this.color;
		args.splice(1, 0, c, "color: inherit");
		let index = 0, lastC = 0;
		args[0].replace(/%[a-zA-Z%]/g, (match) => {
			match !== "%%" && (index++, match === "%c" && (lastC = index));
		}), args.splice(lastC, 0, c);
	}
	exports.log = console.debug || console.log || (() => {});
	function save(namespaces) {
		try {
			namespaces ? exports.storage.setItem("debug", namespaces) : exports.storage.removeItem("debug");
		} catch {}
	}
	function load() {
		let r;
		try {
			r = exports.storage.getItem("debug") || exports.storage.getItem("DEBUG");
		} catch {}
		return !r && typeof process < "u" && "env" in process && (r = process.env.DEBUG), r;
	}
	function localstorage() {
		try {
			return localStorage;
		} catch {}
	}
	module.exports = require_common()(exports);
	let { formatters } = module.exports;
	formatters.j = function(v) {
		try {
			return JSON.stringify(v);
		} catch (error) {
			return "[UnexpectedJSONParseError]: " + error.message;
		}
	};
})), require_has_flag = __commonJSMin(((exports, module) => {
	module.exports = (flag, argv = process.argv) => {
		let prefix = flag.startsWith("-") ? "" : flag.length === 1 ? "-" : "--", position = argv.indexOf(prefix + flag), terminatorPosition = argv.indexOf("--");
		return position !== -1 && (terminatorPosition === -1 || position < terminatorPosition);
	};
})), require_supports_color = __commonJSMin(((exports, module) => {
	let os$1 = require("os"), tty$1 = require("tty"), hasFlag = require_has_flag(), { env } = process, forceColor;
	hasFlag("no-color") || hasFlag("no-colors") || hasFlag("color=false") || hasFlag("color=never") ? forceColor = 0 : (hasFlag("color") || hasFlag("colors") || hasFlag("color=true") || hasFlag("color=always")) && (forceColor = 1), "FORCE_COLOR" in env && (forceColor = env.FORCE_COLOR === "true" ? 1 : env.FORCE_COLOR === "false" ? 0 : env.FORCE_COLOR.length === 0 ? 1 : Math.min(parseInt(env.FORCE_COLOR, 10), 3));
	function translateLevel(level) {
		return level !== 0 && {
			level,
			hasBasic: !0,
			has256: level >= 2,
			has16m: level >= 3
		};
	}
	function supportsColor(haveStream, streamIsTTY) {
		if (forceColor === 0) return 0;
		if (hasFlag("color=16m") || hasFlag("color=full") || hasFlag("color=truecolor")) return 3;
		if (hasFlag("color=256")) return 2;
		if (haveStream && !streamIsTTY && forceColor === void 0) return 0;
		let min = forceColor || 0;
		if (env.TERM === "dumb") return min;
		if (process.platform === "win32") {
			let osRelease = os$1.release().split(".");
			return Number(osRelease[0]) >= 10 && Number(osRelease[2]) >= 10586 ? Number(osRelease[2]) >= 14931 ? 3 : 2 : 1;
		}
		if ("CI" in env) return [
			"TRAVIS",
			"CIRCLECI",
			"APPVEYOR",
			"GITLAB_CI",
			"GITHUB_ACTIONS",
			"BUILDKITE"
		].some((sign) => sign in env) || env.CI_NAME === "codeship" ? 1 : min;
		if ("TEAMCITY_VERSION" in env) return +!!/^(9\.(0*[1-9]\d*)\.|\d{2,}\.)/.test(env.TEAMCITY_VERSION);
		if (env.COLORTERM === "truecolor") return 3;
		if ("TERM_PROGRAM" in env) {
			let version = parseInt((env.TERM_PROGRAM_VERSION || "").split(".")[0], 10);
			switch (env.TERM_PROGRAM) {
				case "iTerm.app": return version >= 3 ? 3 : 2;
				case "Apple_Terminal": return 2;
			}
		}
		return /-256(color)?$/i.test(env.TERM) ? 2 : /^screen|^xterm|^vt100|^vt220|^rxvt|color|ansi|cygwin|linux/i.test(env.TERM) || "COLORTERM" in env ? 1 : min;
	}
	function getSupportLevel(stream) {
		return translateLevel(supportsColor(stream, stream && stream.isTTY));
	}
	module.exports = {
		supportsColor: getSupportLevel,
		stdout: translateLevel(supportsColor(!0, tty$1.isatty(1))),
		stderr: translateLevel(supportsColor(!0, tty$1.isatty(2)))
	};
})), require_node = __commonJSMin(((exports, module) => {
	let tty = require("tty"), util = require("util");
	exports.init = init, exports.log = log, exports.formatArgs = formatArgs, exports.save = save, exports.load = load, exports.useColors = useColors, exports.destroy = util.deprecate(() => {}, "Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`."), exports.colors = [
		6,
		2,
		3,
		4,
		5,
		1
	];
	try {
		let supportsColor = require_supports_color();
		supportsColor && (supportsColor.stderr || supportsColor).level >= 2 && (exports.colors = [
			20,
			21,
			26,
			27,
			32,
			33,
			38,
			39,
			40,
			41,
			42,
			43,
			44,
			45,
			56,
			57,
			62,
			63,
			68,
			69,
			74,
			75,
			76,
			77,
			78,
			79,
			80,
			81,
			92,
			93,
			98,
			99,
			112,
			113,
			128,
			129,
			134,
			135,
			148,
			149,
			160,
			161,
			162,
			163,
			164,
			165,
			166,
			167,
			168,
			169,
			170,
			171,
			172,
			173,
			178,
			179,
			184,
			185,
			196,
			197,
			198,
			199,
			200,
			201,
			202,
			203,
			204,
			205,
			206,
			207,
			208,
			209,
			214,
			215,
			220,
			221
		]);
	} catch {}
	exports.inspectOpts = Object.keys(process.env).filter((key) => /^debug_/i.test(key)).reduce((obj, key) => {
		let prop = key.substring(6).toLowerCase().replace(/_([a-z])/g, (_, k) => k.toUpperCase()), val = process.env[key];
		return val = /^(yes|on|true|enabled)$/i.test(val) ? !0 : /^(no|off|false|disabled)$/i.test(val) ? !1 : val === "null" ? null : Number(val), obj[prop] = val, obj;
	}, {});
	function useColors() {
		return "colors" in exports.inspectOpts ? !!exports.inspectOpts.colors : tty.isatty(process.stderr.fd);
	}
	function formatArgs(args) {
		let { namespace: name, useColors } = this;
		if (useColors) {
			let c = this.color, colorCode = "\x1B[3" + (c < 8 ? c : "8;5;" + c), prefix = `  ${colorCode};1m${name} \u001B[0m`;
			args[0] = prefix + args[0].split("\n").join("\n" + prefix), args.push(colorCode + "m+" + module.exports.humanize(this.diff) + "\x1B[0m");
		} else args[0] = getDate() + name + " " + args[0];
	}
	function getDate() {
		return exports.inspectOpts.hideDate ? "" : new Date().toISOString() + " ";
	}
	function log(...args) {
		return process.stderr.write(util.formatWithOptions(exports.inspectOpts, ...args) + "\n");
	}
	function save(namespaces) {
		namespaces ? process.env.DEBUG = namespaces : delete process.env.DEBUG;
	}
	function load() {
		return process.env.DEBUG;
	}
	function init(debug) {
		debug.inspectOpts = {};
		let keys = Object.keys(exports.inspectOpts);
		for (let i = 0; i < keys.length; i++) debug.inspectOpts[keys[i]] = exports.inspectOpts[keys[i]];
	}
	module.exports = require_common()(exports);
	let { formatters } = module.exports;
	formatters.o = function(v) {
		return this.inspectOpts.colors = this.useColors, util.inspect(v, this.inspectOpts).split("\n").map((str) => str.trim()).join(" ");
	}, formatters.O = function(v) {
		return this.inspectOpts.colors = this.useColors, util.inspect(v, this.inspectOpts);
	};
})), require_src = __commonJSMin(((exports, module) => {
	module.exports = typeof process > "u" || process.type === "renderer" || process.browser === !0 || process.__nwjs ? require_browser() : require_node();
})), require_error$4 = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.DownloadHTTPError = exports.DownloadLengthMismatchError = exports.DownloadError = exports.ExpiredMetadataError = exports.EqualVersionError = exports.BadVersionError = exports.RepositoryError = exports.PersistError = exports.RuntimeError = exports.ValueError = void 0, exports.ValueError = class extends Error {}, exports.RuntimeError = class extends Error {}, exports.PersistError = class extends Error {};
	var RepositoryError = class extends Error {};
	exports.RepositoryError = RepositoryError;
	var BadVersionError = class extends RepositoryError {};
	exports.BadVersionError = BadVersionError, exports.EqualVersionError = class extends BadVersionError {}, exports.ExpiredMetadataError = class extends RepositoryError {};
	var DownloadError = class extends Error {};
	exports.DownloadError = DownloadError, exports.DownloadLengthMismatchError = class extends DownloadError {}, exports.DownloadHTTPError = class extends DownloadError {
		statusCode;
		constructor(message, statusCode) {
			super(message), this.statusCode = statusCode;
		}
	};
})), require_tmpfile = __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.withTempFile = void 0;
	let promises_1 = __importDefault(require("fs/promises")), os_1 = __importDefault(require("os")), path_1$1 = __importDefault(require("path"));
	exports.withTempFile = async (handler) => withTempDir(async (dir) => handler(path_1$1.default.join(dir, "tempfile")));
	let withTempDir = async (handler) => {
		let tmpDir = await promises_1.default.realpath(os_1.default.tmpdir()), dir = await promises_1.default.mkdtemp(tmpDir + path_1$1.default.sep);
		try {
			return await handler(dir);
		} finally {
			await promises_1.default.rm(dir, {
				force: !0,
				recursive: !0,
				maxRetries: 3
			});
		}
	};
})), require_retry = __commonJSMin(((exports, module) => {
	module.exports = { RetryOperation: class {
		#attempts = 1;
		#cachedTimeouts = null;
		#errors = [];
		#fn = null;
		#maxRetryTime;
		#operationStart = null;
		#originalTimeouts;
		#timeouts;
		#timer = null;
		#unref;
		constructor(timeouts, options = {}) {
			this.#originalTimeouts = [...timeouts], this.#timeouts = [...timeouts], this.#unref = options.unref, this.#maxRetryTime = options.maxRetryTime || Infinity, options.forever && (this.#cachedTimeouts = [...this.#timeouts]);
		}
		get timeouts() {
			return [...this.#timeouts];
		}
		get errors() {
			return [...this.#errors];
		}
		get attempts() {
			return this.#attempts;
		}
		get mainError() {
			let mainError = null;
			if (this.#errors.length) {
				let mainErrorCount = 0, counts = {};
				for (let i = 0; i < this.#errors.length; i++) {
					let error = this.#errors[i], { message } = error;
					counts[message] || (counts[message] = 0), counts[message]++, counts[message] >= mainErrorCount && (mainError = error, mainErrorCount = counts[message]);
				}
			}
			return mainError;
		}
		reset() {
			this.#attempts = 1, this.#timeouts = [...this.#originalTimeouts];
		}
		stop() {
			this.#timer && clearTimeout(this.#timer), this.#timeouts = [], this.#cachedTimeouts = null;
		}
		retry(err) {
			if (this.#errors.push(err), new Date().getTime() - this.#operationStart >= this.#maxRetryTime) return this.#errors.unshift(Error("RetryOperation timeout occurred")), !1;
			let timeout = this.#timeouts.shift();
			if (timeout === void 0) {
				if (this.#cachedTimeouts) this.#errors.pop(), timeout = this.#cachedTimeouts.at(-1);
				else return !1;
			}
			return this.#timer = setTimeout(() => {
				this.#attempts++, this.#fn(this.#attempts);
			}, timeout), this.#unref && this.#timer.unref(), !0;
		}
		attempt(fn) {
			this.#fn = fn, this.#operationStart = new Date().getTime(), this.#fn(this.#attempts);
		}
	} };
})), require_lib = __commonJSMin(((exports, module) => {
	let { RetryOperation } = require_retry(), createTimeout = (attempt, opts) => Math.min(Math.round((1 + (opts.randomize ? Math.random() : 0)) * Math.max(opts.minTimeout, 1) * opts.factor ** +attempt), opts.maxTimeout), isRetryError = (err) => err?.code === "EPROMISERETRY" && Object.hasOwn(err, "retried");
	module.exports = { promiseRetry: async (fn, options = {}) => {
		let timeouts = [];
		if (options instanceof Array) timeouts = [...options];
		else {
			options.retries === Infinity && (options.forever = !0, delete options.retries);
			let opts = {
				retries: 10,
				factor: 2,
				minTimeout: 1e3,
				maxTimeout: Infinity,
				randomize: !1,
				...options
			};
			if (opts.minTimeout > opts.maxTimeout) throw Error("minTimeout is greater than maxTimeout");
			if (opts.retries) {
				for (let i = 0; i < opts.retries; i++) timeouts.push(createTimeout(i, opts));
				timeouts.sort((a, b) => a - b);
			} else options.forever && timeouts.push(createTimeout(0, opts));
		}
		let operation = new RetryOperation(timeouts, {
			forever: options.forever,
			unref: options.unref,
			maxRetryTime: options.maxRetryTime
		});
		return new Promise(function(resolve, reject) {
			operation.attempt(async (number) => {
				try {
					return resolve(await fn((err) => {
						throw Object.assign(Error("Retrying"), {
							code: "EPROMISERETRY",
							retried: err
						});
					}, number, operation));
				} catch (err) {
					if (!isRetryError(err)) return reject(err);
					if (!operation.retry(err.retried || Error())) return reject(err.retried);
				}
			});
		});
	} };
})), require_fetcher = __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.DefaultFetcher = exports.BaseFetcher = void 0;
	let debug_1 = __importDefault(require_src()), fs_1$2 = __importDefault(require("fs")), util_1$1 = __importDefault(require("util")), error_1 = require_error$4(), tmpfile_1 = require_tmpfile(), promise_retry_1 = require_lib(), log = (0, debug_1.default)("tuf:fetch");
	var BaseFetcher = class {
		async downloadFile(url, maxLength, handler) {
			return (0, tmpfile_1.withTempFile)(async (tmpFile) => {
				let reader = await this.fetch(url), numberOfBytesReceived = 0, fileStream = fs_1$2.default.createWriteStream(tmpFile), streamReader = reader.getReader();
				try {
					for (;;) {
						let { done, value: chunk } = await streamReader.read();
						if (done) break;
						if (numberOfBytesReceived += chunk.length, numberOfBytesReceived > maxLength) throw new error_1.DownloadLengthMismatchError("Max length reached");
						await writeBufferToStream(fileStream, Buffer.from(chunk));
					}
				} finally {
					streamReader.releaseLock(), await util_1$1.default.promisify(fileStream.close).bind(fileStream)();
				}
				return handler(tmpFile);
			});
		}
		async downloadBytes(url, maxLength) {
			return this.downloadFile(url, maxLength, async (file) => {
				let stream = fs_1$2.default.createReadStream(file), chunks = [];
				for await (let chunk of stream) chunks.push(chunk);
				return Buffer.concat(chunks);
			});
		}
	};
	exports.BaseFetcher = BaseFetcher, exports.DefaultFetcher = class extends BaseFetcher {
		userAgent;
		timeout;
		retry;
		constructor(options = {}) {
			if (super(), this.userAgent = options.userAgent, this.timeout = options.timeout, options.retry === !0) this.retry = { forever: !0 };
			else if (options.retry === !1 || options.retry === void 0) this.retry = void 0;
			else if (typeof options.retry == "number") {
				if (options.retry < 0) throw Error("Retry count must be non-negative number");
				this.retry = { retries: options.retry };
			} else this.retry = options.retry;
		}
		async fetch(url) {
			let shouldRetry = this.retry !== void 0;
			return (0, promise_retry_1.promiseRetry)(async (retry, number) => {
				log("GET %s (attempt %d)", url, number);
				let response;
				try {
					response = await fetch(url, {
						headers: { "User-Agent": this.userAgent || "" },
						signal: this.timeout ? AbortSignal.timeout(this.timeout) : void 0
					});
				} catch (error) {
					let err = error instanceof Error ? error : Error(String(error));
					if (shouldRetry) return retry(err);
					throw err;
				}
				if (!response.ok || !response.body) {
					let err = new error_1.DownloadHTTPError("Failed to download", response.status);
					if (shouldRetry && response.status >= 500 && response.status < 600) return retry(err);
					throw err;
				}
				return response.body;
			}, this.retry);
		}
	};
	let writeBufferToStream = async (stream, buffer) => new Promise((resolve, reject) => {
		stream.write(buffer, (err) => {
			err && reject(err), resolve(!0);
		});
	});
})), require_package$1 = __commonJSMin(((exports, module) => {
	module.exports = {
		name: "tuf-js",
		version: "6.0.0",
		description: "JavaScript implementation of The Update Framework (TUF)",
		main: "dist/index.js",
		types: "dist/index.d.ts",
		scripts: {
			build: "tsc --build tsconfig.build.json",
			clean: "rm -rf dist && rm tsconfig.build.tsbuildinfo",
			test: "jest"
		},
		repository: {
			type: "git",
			url: "git+https://github.com/theupdateframework/tuf-js.git"
		},
		files: ["dist"],
		keywords: [
			"tuf",
			"security",
			"update"
		],
		author: "bdehamer@github.com",
		license: "MIT",
		bugs: { url: "https://github.com/theupdateframework/tuf-js/issues" },
		homepage: "https://github.com/theupdateframework/tuf-js/tree/main/packages/client#readme",
		devDependencies: {
			"@tufjs/repo-mock": "5.0.0",
			"@types/debug": "^4.1.13",
			"@types/retry": "^0.12.5"
		},
		dependencies: {
			"@gar/promise-retry": "^1.0.3",
			"@tufjs/models": "5.0.0",
			debug: "^4.4.3"
		},
		engines: { node: "^22.22.2 || ^24.15.0 || >=26.0.0" }
	};
})), require_config = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.defaultConfig = void 0, exports.defaultConfig = {
		maxRootRotations: 256,
		maxDelegations: 32,
		rootMaxLength: 512e3,
		timestampMaxLength: 16384,
		snapshotMaxLength: 2e6,
		targetsMaxLength: 5e6,
		prefixTargetsWithHash: !0,
		fetchTimeout: 1e5,
		fetchRetries: void 0,
		fetchRetry: 2,
		userAgent: ""
	};
})), require_store = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.TrustedMetadataStore = void 0;
	let models_1 = require_dist$4(), error_1 = require_error$4();
	exports.TrustedMetadataStore = class {
		trustedSet = {};
		referenceTime;
		constructor(rootData) {
			this.referenceTime = new Date(), this.loadTrustedRoot(rootData);
		}
		get root() {
			if (!this.trustedSet.root) throw ReferenceError("No trusted root metadata");
			return this.trustedSet.root;
		}
		get timestamp() {
			return this.trustedSet.timestamp;
		}
		get snapshot() {
			return this.trustedSet.snapshot;
		}
		get targets() {
			return this.trustedSet.targets;
		}
		getRole(name) {
			return this.trustedSet[name];
		}
		updateRoot(bytesBuffer) {
			let data = JSON.parse(bytesBuffer.toString("utf8")), newRoot = models_1.Metadata.fromJSON(models_1.MetadataKind.Root, data);
			if (newRoot.signed.type != models_1.MetadataKind.Root) throw new error_1.RepositoryError(`Expected 'root', got ${newRoot.signed.type}`);
			if (this.root.verifyDelegate(models_1.MetadataKind.Root, newRoot), newRoot.signed.version != this.root.signed.version + 1) throw new error_1.BadVersionError(`Expected version ${this.root.signed.version + 1}, got ${newRoot.signed.version}`);
			return newRoot.verifyDelegate(models_1.MetadataKind.Root, newRoot), this.trustedSet.root = newRoot, newRoot;
		}
		updateTimestamp(bytesBuffer) {
			if (this.snapshot) throw new error_1.RuntimeError("Cannot update timestamp after snapshot");
			if (this.root.signed.isExpired(this.referenceTime)) throw new error_1.ExpiredMetadataError("Final root.json is expired");
			let data = JSON.parse(bytesBuffer.toString("utf8")), newTimestamp = models_1.Metadata.fromJSON(models_1.MetadataKind.Timestamp, data);
			if (newTimestamp.signed.type != models_1.MetadataKind.Timestamp) throw new error_1.RepositoryError(`Expected 'timestamp', got ${newTimestamp.signed.type}`);
			if (this.root.verifyDelegate(models_1.MetadataKind.Timestamp, newTimestamp), this.timestamp) {
				if (newTimestamp.signed.version < this.timestamp.signed.version) throw new error_1.BadVersionError(`New timestamp version ${newTimestamp.signed.version} is less than current version ${this.timestamp.signed.version}`);
				if (newTimestamp.signed.version === this.timestamp.signed.version) throw new error_1.EqualVersionError(`New timestamp version ${newTimestamp.signed.version} is equal to current version ${this.timestamp.signed.version}`);
				let snapshotMeta = this.timestamp.signed.snapshotMeta, newSnapshotMeta = newTimestamp.signed.snapshotMeta;
				if (newSnapshotMeta.version < snapshotMeta.version) throw new error_1.BadVersionError(`New snapshot version ${newSnapshotMeta.version} is less than current version ${snapshotMeta.version}`);
			}
			return this.trustedSet.timestamp = newTimestamp, this.checkFinalTimestamp(), newTimestamp;
		}
		updateSnapshot(bytesBuffer, trusted = !1) {
			if (!this.timestamp) throw new error_1.RuntimeError("Cannot update snapshot before timestamp");
			if (this.targets) throw new error_1.RuntimeError("Cannot update snapshot after targets");
			this.checkFinalTimestamp();
			let snapshotMeta = this.timestamp.signed.snapshotMeta;
			trusted || snapshotMeta.verify(bytesBuffer);
			let data = JSON.parse(bytesBuffer.toString("utf8")), newSnapshot = models_1.Metadata.fromJSON(models_1.MetadataKind.Snapshot, data);
			if (newSnapshot.signed.type != models_1.MetadataKind.Snapshot) throw new error_1.RepositoryError(`Expected 'snapshot', got ${newSnapshot.signed.type}`);
			return this.root.verifyDelegate(models_1.MetadataKind.Snapshot, newSnapshot), this.snapshot && Object.entries(this.snapshot.signed.meta).forEach(([fileName, fileInfo]) => {
				let newFileInfo = newSnapshot.signed.meta[fileName];
				if (!newFileInfo) throw new error_1.RepositoryError(`Missing file ${fileName} in new snapshot`);
				if (newFileInfo.version < fileInfo.version) throw new error_1.BadVersionError(`New version ${newFileInfo.version} of ${fileName} is less than current version ${fileInfo.version}`);
			}), this.trustedSet.snapshot = newSnapshot, this.checkFinalSnapsnot(), newSnapshot;
		}
		updateDelegatedTargets(bytesBuffer, roleName, delegatorName) {
			if (!this.snapshot) throw new error_1.RuntimeError("Cannot update delegated targets before snapshot");
			this.checkFinalSnapsnot();
			let delegator = this.trustedSet[delegatorName];
			if (!delegator) throw new error_1.RuntimeError(`No trusted ${delegatorName} metadata`);
			let meta = this.snapshot.signed.meta?.[`${roleName}.json`];
			if (!meta) throw new error_1.RepositoryError(`Missing ${roleName}.json in snapshot`);
			meta.verify(bytesBuffer);
			let data = JSON.parse(bytesBuffer.toString("utf8")), newDelegate = models_1.Metadata.fromJSON(models_1.MetadataKind.Targets, data);
			if (newDelegate.signed.type != models_1.MetadataKind.Targets) throw new error_1.RepositoryError(`Expected 'targets', got ${newDelegate.signed.type}`);
			delegator.verifyDelegate(roleName, newDelegate);
			let version = newDelegate.signed.version;
			if (version != meta.version) throw new error_1.BadVersionError(`Version ${version} of ${roleName} does not match snapshot version ${meta.version}`);
			if (newDelegate.signed.isExpired(this.referenceTime)) throw new error_1.ExpiredMetadataError(`${roleName}.json is expired`);
			this.trustedSet[roleName] = newDelegate;
		}
		loadTrustedRoot(bytesBuffer) {
			let data = JSON.parse(bytesBuffer.toString("utf8")), root = models_1.Metadata.fromJSON(models_1.MetadataKind.Root, data);
			if (root.signed.type != models_1.MetadataKind.Root) throw new error_1.RepositoryError(`Expected 'root', got ${root.signed.type}`);
			root.verifyDelegate(models_1.MetadataKind.Root, root), this.trustedSet.root = root;
		}
		checkFinalTimestamp() {
			if (!this.timestamp) throw ReferenceError("No trusted timestamp metadata");
			if (this.timestamp.signed.isExpired(this.referenceTime)) throw new error_1.ExpiredMetadataError("Final timestamp.json is expired");
		}
		checkFinalSnapsnot() {
			if (!this.snapshot) throw ReferenceError("No trusted snapshot metadata");
			if (!this.timestamp) throw ReferenceError("No trusted timestamp metadata");
			if (this.snapshot.signed.isExpired(this.referenceTime)) throw new error_1.ExpiredMetadataError("snapshot.json is expired");
			let snapshotMeta = this.timestamp.signed.snapshotMeta;
			if (this.snapshot.signed.version !== snapshotMeta.version) throw new error_1.BadVersionError("Snapshot version doesn't match timestamp");
		}
	};
})), require_url = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.join = join;
	let url_1 = require("url");
	function join(base, path) {
		return new url_1.URL(ensureTrailingSlash(base) + removeLeadingSlash(path)).toString();
	}
	function ensureTrailingSlash(path) {
		return path.endsWith("/") ? path : path + "/";
	}
	function removeLeadingSlash(path) {
		return path.startsWith("/") ? path.slice(1) : path;
	}
})), require_updater = __commonJSMin(((exports) => {
	var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k);
		var desc = Object.getOwnPropertyDescriptor(m, k);
		(!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) && (desc = {
			enumerable: !0,
			get: function() {
				return m[k];
			}
		}), Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k), o[k2] = m[k];
	})), __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
		Object.defineProperty(o, "default", {
			enumerable: !0,
			value: v
		});
	}) : function(o, v) {
		o.default = v;
	}), __importStar = exports && exports.__importStar || (function() {
		var ownKeys = function(o) {
			return ownKeys = Object.getOwnPropertyNames || function(o) {
				var ar = [];
				for (var k in o) Object.prototype.hasOwnProperty.call(o, k) && (ar[ar.length] = k);
				return ar;
			}, ownKeys(o);
		};
		return function(mod) {
			if (mod && mod.__esModule) return mod;
			var result = {};
			if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) k[i] !== "default" && __createBinding(result, mod, k[i]);
			return __setModuleDefault(result, mod), result;
		};
	})(), __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Updater = void 0;
	let models_1 = require_dist$4(), debug_1 = __importDefault(require_src()), fs$1 = __importStar(require("fs")), path$1 = __importStar(require("path")), package_json_1 = require_package$1(), config_1 = require_config(), error_1 = require_error$4(), fetcher_1 = require_fetcher(), store_1 = require_store(), url = __importStar(require_url()), log = (0, debug_1.default)("tuf:cache");
	exports.Updater = class {
		dir;
		metadataBaseUrl;
		targetDir;
		targetBaseUrl;
		forceCache;
		trustedSet;
		config;
		fetcher;
		constructor(options) {
			let { metadataDir, metadataBaseUrl, targetDir, targetBaseUrl, fetcher, config } = options;
			this.dir = metadataDir, this.metadataBaseUrl = metadataBaseUrl, this.targetDir = targetDir, this.targetBaseUrl = targetBaseUrl, this.forceCache = options.forceCache ?? !1;
			let data = this.loadLocalMetadata(models_1.MetadataKind.Root);
			this.trustedSet = new store_1.TrustedMetadataStore(data), this.config = {
				...config_1.defaultConfig,
				...config
			};
			let userAgent = config?.userAgent ? `${config.userAgent} tuf-js/${package_json_1.version}` : `tuf-js/${package_json_1.version}`;
			this.fetcher = fetcher || new fetcher_1.DefaultFetcher({
				userAgent,
				timeout: this.config.fetchTimeout,
				retry: this.config.fetchRetries ?? this.config.fetchRetry
			});
		}
		async refresh() {
			if (this.forceCache) try {
				await this.loadTimestamp({ checkRemote: !1 });
			} catch {
				await this.loadRoot(), await this.loadTimestamp();
			}
			else await this.loadRoot(), await this.loadTimestamp();
			await this.loadSnapshot(), await this.loadTargets(models_1.MetadataKind.Targets, models_1.MetadataKind.Root);
		}
		async getTargetInfo(targetPath) {
			return this.trustedSet.targets || await this.refresh(), this.preorderDepthFirstWalk(targetPath);
		}
		async downloadTarget(targetInfo, filePath, targetBaseUrl) {
			let targetPath = filePath || this.generateTargetPath(targetInfo);
			if (!targetBaseUrl) {
				if (!this.targetBaseUrl) throw new error_1.ValueError("Target base URL not set");
				targetBaseUrl = this.targetBaseUrl;
			}
			let targetFilePath = targetInfo.path;
			if (this.trustedSet.root.signed.consistentSnapshot && this.config.prefixTargetsWithHash) {
				let hashes = Object.values(targetInfo.hashes), { dir, base } = path$1.parse(targetFilePath), filename = `${hashes[0]}.${base}`;
				targetFilePath = dir ? `${dir}/${filename}` : filename;
			}
			let targetUrl = url.join(targetBaseUrl, targetFilePath);
			return await this.fetcher.downloadFile(targetUrl, targetInfo.length, async (fileName) => {
				await targetInfo.verify(fs$1.createReadStream(fileName)), log("WRITE %s", targetPath), fs$1.copyFileSync(fileName, targetPath);
			}), targetPath;
		}
		async findCachedTarget(targetInfo, filePath) {
			filePath ||= this.generateTargetPath(targetInfo);
			try {
				if (fs$1.existsSync(filePath)) return await targetInfo.verify(fs$1.createReadStream(filePath)), filePath;
			} catch {
				return;
			}
		}
		loadLocalMetadata(fileName) {
			let filePath = path$1.join(this.dir, `${fileName}.json`);
			return log("READ %s", filePath), fs$1.readFileSync(filePath);
		}
		async loadRoot() {
			let lowerBound = this.trustedSet.root.signed.version + 1, upperBound = lowerBound + this.config.maxRootRotations;
			for (let version = lowerBound; version < upperBound; version++) {
				let rootUrl = url.join(this.metadataBaseUrl, `${version}.root.json`);
				try {
					let bytesData = await this.fetcher.downloadBytes(rootUrl, this.config.rootMaxLength);
					this.trustedSet.updateRoot(bytesData), this.persistMetadata(models_1.MetadataKind.Root, bytesData);
				} catch (error) {
					if (error instanceof error_1.DownloadHTTPError && [403, 404].includes(error.statusCode)) break;
					throw error;
				}
			}
		}
		async loadTimestamp({ checkRemote } = { checkRemote: !0 }) {
			try {
				let data = this.loadLocalMetadata(models_1.MetadataKind.Timestamp);
				if (this.trustedSet.updateTimestamp(data), !checkRemote) return;
			} catch {}
			let timestampUrl = url.join(this.metadataBaseUrl, "timestamp.json"), bytesData = await this.fetcher.downloadBytes(timestampUrl, this.config.timestampMaxLength);
			try {
				this.trustedSet.updateTimestamp(bytesData);
			} catch (error) {
				if (error instanceof error_1.EqualVersionError) return;
				throw error;
			}
			this.persistMetadata(models_1.MetadataKind.Timestamp, bytesData);
		}
		async loadSnapshot() {
			try {
				let data = this.loadLocalMetadata(models_1.MetadataKind.Snapshot);
				this.trustedSet.updateSnapshot(data, !0);
			} catch (error) {
				if (!this.trustedSet.timestamp) throw ReferenceError("No timestamp metadata", { cause: error });
				let snapshotMeta = this.trustedSet.timestamp.signed.snapshotMeta, maxLength = snapshotMeta.length || this.config.snapshotMaxLength, version = this.trustedSet.root.signed.consistentSnapshot ? snapshotMeta.version : void 0, snapshotUrl = url.join(this.metadataBaseUrl, version ? `${version}.snapshot.json` : "snapshot.json");
				try {
					let bytesData = await this.fetcher.downloadBytes(snapshotUrl, maxLength);
					this.trustedSet.updateSnapshot(bytesData), this.persistMetadata(models_1.MetadataKind.Snapshot, bytesData);
				} catch (error) {
					throw new error_1.RuntimeError(`Unable to load snapshot metadata error ${error}`);
				}
			}
		}
		async loadTargets(role, parentRole) {
			if (this.trustedSet.getRole(role)) return this.trustedSet.getRole(role);
			try {
				let buffer = this.loadLocalMetadata(role);
				this.trustedSet.updateDelegatedTargets(buffer, role, parentRole);
			} catch (error) {
				if (!this.trustedSet.snapshot) throw ReferenceError("No snapshot metadata", { cause: error });
				let metaInfo = this.trustedSet.snapshot.signed.meta[`${role}.json`], maxLength = metaInfo.length || this.config.targetsMaxLength, version = this.trustedSet.root.signed.consistentSnapshot ? metaInfo.version : void 0, encodedRole = encodeURIComponent(role), metadataUrl = url.join(this.metadataBaseUrl, version ? `${version}.${encodedRole}.json` : `${encodedRole}.json`);
				try {
					let bytesData = await this.fetcher.downloadBytes(metadataUrl, maxLength);
					this.trustedSet.updateDelegatedTargets(bytesData, role, parentRole), this.persistMetadata(role, bytesData);
				} catch (error) {
					throw new error_1.RuntimeError(`Unable to load targets error ${error}`);
				}
			}
			return this.trustedSet.getRole(role);
		}
		async preorderDepthFirstWalk(targetPath) {
			let delegationsToVisit = [{
				roleName: models_1.MetadataKind.Targets,
				parentRoleName: models_1.MetadataKind.Root
			}], visitedRoleNames = new Set();
			for (; visitedRoleNames.size <= this.config.maxDelegations && delegationsToVisit.length > 0;) {
				let { roleName, parentRoleName } = delegationsToVisit.pop();
				if (visitedRoleNames.has(roleName)) continue;
				let targets = (await this.loadTargets(roleName, parentRoleName))?.signed;
				if (!targets) continue;
				let target = targets.targets?.[targetPath];
				if (target) return target;
				if (visitedRoleNames.add(roleName), targets.delegations) {
					let childRolesToVisit = [], rolesForTarget = targets.delegations.rolesForTarget(targetPath);
					for (let { role: childName, terminating } of rolesForTarget) if (childRolesToVisit.push({
						roleName: childName,
						parentRoleName: roleName
					}), terminating) {
						delegationsToVisit.splice(0);
						break;
					}
					childRolesToVisit.reverse(), delegationsToVisit.push(...childRolesToVisit);
				}
			}
		}
		generateTargetPath(targetInfo) {
			if (!this.targetDir) throw new error_1.ValueError("Target directory not set");
			let filePath = encodeURIComponent(targetInfo.path);
			return path$1.join(this.targetDir, filePath);
		}
		persistMetadata(metaDataName, bytesData) {
			let encodedName = encodeURIComponent(metaDataName);
			try {
				let filePath = path$1.join(this.dir, `${encodedName}.json`);
				log("WRITE %s", filePath), fs$1.writeFileSync(filePath, bytesData.toString("utf8"));
			} catch (error) {
				throw new error_1.PersistError(`Failed to persist metadata ${encodedName} error: ${error}`);
			}
		}
	};
})), require_dist$3 = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Updater = exports.BaseFetcher = exports.TargetFile = void 0;
	var models_1 = require_dist$4();
	Object.defineProperty(exports, "TargetFile", {
		enumerable: !0,
		get: function() {
			return models_1.TargetFile;
		}
	});
	var fetcher_1 = require_fetcher();
	Object.defineProperty(exports, "BaseFetcher", {
		enumerable: !0,
		get: function() {
			return fetcher_1.BaseFetcher;
		}
	});
	var updater_1 = require_updater();
	Object.defineProperty(exports, "Updater", {
		enumerable: !0,
		get: function() {
			return updater_1.Updater;
		}
	});
})), require_package = __commonJSMin(((exports, module) => {
	module.exports = {
		name: "@sigstore/tuf",
		version: "5.0.0",
		description: "Client for the Sigstore TUF repository",
		main: "dist/index.js",
		types: "dist/index.d.ts",
		scripts: {
			clean: "shx rm -rf dist *.tsbuildinfo",
			build: "tsc --build",
			test: "jest"
		},
		files: ["dist", "seeds.json"],
		author: "bdehamer@github.com",
		license: "Apache-2.0",
		repository: {
			type: "git",
			url: "git+https://github.com/sigstore/sigstore-js.git"
		},
		bugs: { url: "https://github.com/sigstore/sigstore-js/issues" },
		homepage: "https://github.com/sigstore/sigstore-js/tree/main/packages/tuf#readme",
		publishConfig: { provenance: !0 },
		devDependencies: {
			"@sigstore/jest": "^0.0.0",
			"@tufjs/repo-mock": "^5.0.0",
			"@types/make-fetch-happen": "^10.0.4"
		},
		dependencies: {
			"@sigstore/protobuf-specs": "^0.5.0",
			"tuf-js": "^6.0.0"
		},
		engines: { node: "^22.22.2 || ^24.15.0 || >=26.0.0" }
	};
})), require_error$3 = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.TUFError = void 0, exports.TUFError = class extends Error {
		code;
		cause;
		constructor({ code, message, cause }) {
			super(message), this.code = code, this.cause = cause, this.name = this.constructor.name;
		}
	};
})), require_target = __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.readTarget = readTarget;
	let fs_1$1 = __importDefault(require("fs")), error_1 = require_error$3();
	async function readTarget(tuf, targetPath) {
		let path = await getTargetPath(tuf, targetPath);
		return new Promise((resolve, reject) => {
			fs_1$1.default.readFile(path, "utf-8", (err, data) => {
				err ? reject(new error_1.TUFError({
					code: "TUF_READ_TARGET_ERROR",
					message: `error reading target ${path}`,
					cause: err
				})) : resolve(data);
			});
		});
	}
	async function getTargetPath(tuf, target) {
		let targetInfo;
		try {
			targetInfo = await tuf.getTargetInfo(target);
		} catch (err) {
			throw new error_1.TUFError({
				code: "TUF_REFRESH_METADATA_ERROR",
				message: "error refreshing TUF metadata",
				cause: err
			});
		}
		if (!targetInfo) throw new error_1.TUFError({
			code: "TUF_FIND_TARGET_ERROR",
			message: `target ${target} not found`
		});
		let path = await tuf.findCachedTarget(targetInfo);
		if (!path) try {
			path = await tuf.downloadTarget(targetInfo);
		} catch (err) {
			throw new error_1.TUFError({
				code: "TUF_DOWNLOAD_TARGET_ERROR",
				message: `error downloading target ${path}`,
				cause: err
			});
		}
		return path;
	}
})), require_seeds = __commonJSMin(((exports, module) => {
	module.exports = { "https://tuf-repo-cdn.sigstore.dev": {
		"root.json": "ewogInNpZ25hdHVyZXMiOiBbCiAgewogICAia2V5aWQiOiAiZTcxYTU0ZDU0MzgzNWJhODZhZGFkOTQ2MDM3OWM3NjQxZmI4NzI2ZDE2NGVhNzY2ODAxYTFjNTIyYWJhN2VhMiIsCiAgICJzaWciOiAiMzA0NTAyMjEwMGVhMmYzNzRmNDA5ODEwZTJkYjk1MDc0OWQ5Y2ZlZDA5YTE1YjZhNWUyNWYzZDVmZmQwNzk5NDU5ZDdiZWUxNjcwMjIwMjhkM2FjZGRlNmRiZDUwMzRjZmFkMjIyZDMxYjQxMDkwZWUyMTg5NGUyYzQ2Y2I4OTc0MTk4YWIwMzc3ZGI0NCIKICB9LAogIHsKICAgImtleWlkIjogIjIyZjRjYWVjNmQ4ZTZmOTU1NWFmNjZiM2Q0YzNjYjA2YTNiYjIzZmRjN2UzOWM5MTZjNjFmNDYyZTZmNTJiMDYiLAogICAic2lnIjogIjMwNDQwMjIwN2ViYjI0ZTMyMzdlNDcwNjkxZDc4NzU5MDNhNzc1NGQwZWYyYWU3ZTdiNTAyNGE3ODg4YzlhMzhhNTJkZWVjZDAyMjA2ZWQ1YWQxYzZmNGZhYjQ2OTk1ODQzYWI2YjIzZjk0MjBjNWE0Y2Y2Y2UxY2IyY2IyYTZmYzJlODdlMmVmM2UxIgogIH0sCiAgewogICAia2V5aWQiOiAiNjE2NDM4MzgxMjViNDQwYjQwZGI2OTQyZjVjYjVhMzFjMGRjMDQzNjgzMTZlYjJhYWE1OGI5NTkwNGE1ODIyMiIsCiAgICJzaWciOiAiMzA0NjAyMjEwMDg5ZDlkZmQ4ZTEwNmNjOTU4MDg4YTRkYTNjOGNmNzI1NGFiNmY2NWE5NjQ3ZDM3YWRhNzMwZWY0NzYzYzUxNjMwMjIxMDBkODgyZWU3NDQ2MTViZTc5ODYxZTIxNGUxZWViOWUxZWRkZjZhMWUyMDNhMjAxYjRjNWQwM2Y1MjI0ZDcxZDE2IgogIH0sCiAgewogICAia2V5aWQiOiAiYTY4N2U1YmY0ZmFiODJiMGVlNThkNDZlMDVjOTUzNTE0NWEyYzlhZmI0NThmNDNkNDJiNDVjYTBmZGNlMmE3MCIsCiAgICJzaWciOiAiMzA0NTAyMjEwMDg4YmQ0Yjg4ZTgzZjU4NmNlNTY4ZDI3ZDA0MjE0YzRhYjNmZDE4OTQxNzhlZjAxNTMwM2Q1NmFmYTkzOTIwNTMwMjIwNTUzOGViYWI5Mzg3NmFiYjkwNzVhZDc3MTE0YmZmMjhhMGQ3OWE3Y2MyMjliNTM0YTBjNWNlZDU1MjZiNDhlNyIKICB9LAogIHsKICAgImtleWlkIjogIjE4M2U2NGYzNzY3MGRjMTNjYTBkMjg5OTVhMzA1M2YzNzQwOTU0ZGRjZTQ0MzIxYTQxZTQ2NTM0Y2Y0NGU2MzIiLAogICAic2lnIjogIjMwNDUwMjIxMDBmMzViMDdlOTM4ZDQ5NDljYWY4MmU2OWU4NmNjOWRiM2I2OWI2ZGJjNjc0MGMxZjM0M2QwNjg5M2Y5OTZmYmViMDIyMDAxZTg0N2Q4MTYyNTlhOTZhNDllNDI3NzlhMjM1MGRhYjk3YjcxYzhhZTdlMjZiMjM4MGM2ZmE3ZjU4MTMxYjMiCiAgfQogXSwKICJzaWduZWQiOiB7CiAgIl90eXBlIjogInJvb3QiLAogICJjb25zaXN0ZW50X3NuYXBzaG90IjogdHJ1ZSwKICAiZXhwaXJlcyI6ICIyMDI2LTExLTIwVDEzOjU4OjE4WiIsCiAgImtleXMiOiB7CiAgICIwYzg3NDMyYzNiZjA5ZmQ5OTE4OWZkYzMyZmE1ZWFlZGY0ZTRhNWZhYzdiYWI3M2ZhMDRhMmUwZmM2NGFmNmY1IjogewogICAgImtleWlkX2hhc2hfYWxnb3JpdGhtcyI6IFsKICAgICAic2hhMjU2IiwKICAgICAic2hhNTEyIgogICAgXSwKICAgICJrZXl0eXBlIjogImVjZHNhIiwKICAgICJrZXl2YWwiOiB7CiAgICAgInB1YmxpYyI6ICItLS0tLUJFR0lOIFBVQkxJQyBLRVktLS0tLVxuTUZrd0V3WUhLb1pJemowQ0FRWUlLb1pJemowREFRY0RRZ0FFV1JpR3I1K2orM0o1U3NIK1p0cjVuRTJIMndPN1xuQlYrbk8zczkzZ0xjYTE4cVRPekhZMW9XeUFHRHlrTVNzR1RVQlN0OUQrQW4wS2ZLc0QybWZTTTQyUT09XG4tLS0tLUVORCBQVUJMSUMgS0VZLS0tLS1cbiIKICAgIH0sCiAgICAic2NoZW1lIjogImVjZHNhLXNoYTItbmlzdHAyNTYiLAogICAgIngtdHVmLW9uLWNpLW9ubGluZS11cmkiOiAiZ2Nwa21zOnByb2plY3RzL3NpZ3N0b3JlLXJvb3Qtc2lnbmluZy9sb2NhdGlvbnMvZ2xvYmFsL2tleVJpbmdzL3Jvb3QvY3J5cHRvS2V5cy90aW1lc3RhbXAvY3J5cHRvS2V5VmVyc2lvbnMvMSIKICAgfSwKICAgIjE4M2U2NGYzNzY3MGRjMTNjYTBkMjg5OTVhMzA1M2YzNzQwOTU0ZGRjZTQ0MzIxYTQxZTQ2NTM0Y2Y0NGU2MzIiOiB7CiAgICAia2V5dHlwZSI6ICJlY2RzYSIsCiAgICAia2V5dmFsIjogewogICAgICJwdWJsaWMiOiAiLS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS1cbk1Ga3dFd1lIS29aSXpqMENBUVlJS29aSXpqMERBUWNEUWdBRU14cFBPSkNJWjVvdEc0MTA2ZkdKc2VFUWkzVjlcbnBrTVlRNHV5VjlUajFNN1dIWEl5TEcramtmdnVHMGdsUTFKWmJSWlpCVjNnQVI0c29qZEdISVNlb3c9PVxuLS0tLS1FTkQgUFVCTElDIEtFWS0tLS0tXG4iCiAgICB9LAogICAgInNjaGVtZSI6ICJlY2RzYS1zaGEyLW5pc3RwMjU2IiwKICAgICJ4LXR1Zi1vbi1jaS1rZXlvd25lciI6ICJAbGFuY2UiCiAgIH0sCiAgICIyMmY0Y2FlYzZkOGU2Zjk1NTVhZjY2YjNkNGMzY2IwNmEzYmIyM2ZkYzdlMzljOTE2YzYxZjQ2MmU2ZjUyYjA2IjogewogICAgImtleWlkX2hhc2hfYWxnb3JpdGhtcyI6IFsKICAgICAic2hhMjU2IiwKICAgICAic2hhNTEyIgogICAgXSwKICAgICJrZXl0eXBlIjogImVjZHNhIiwKICAgICJrZXl2YWwiOiB7CiAgICAgInB1YmxpYyI6ICItLS0tLUJFR0lOIFBVQkxJQyBLRVktLS0tLVxuTUZrd0V3WUhLb1pJemowQ0FRWUlLb1pJemowREFRY0RRZ0FFekJ6Vk9tSENQb2pNVkxTSTM2NFdpaVY4TlByRFxuNklnUnhWbGlza3ovdit5M0pFUjVtY1ZHY09ObGlEY1dNQzVKMmxmSG1qUE5QaGI0SDd4bThMemZTQT09XG4tLS0tLUVORCBQVUJMSUMgS0VZLS0tLS1cbiIKICAgIH0sCiAgICAic2NoZW1lIjogImVjZHNhLXNoYTItbmlzdHAyNTYiLAogICAgIngtdHVmLW9uLWNpLWtleW93bmVyIjogIkBzYW50aWFnb3RvcnJlcyIKICAgfSwKICAgIjYxNjQzODM4MTI1YjQ0MGI0MGRiNjk0MmY1Y2I1YTMxYzBkYzA0MzY4MzE2ZWIyYWFhNThiOTU5MDRhNTgyMjIiOiB7CiAgICAia2V5aWRfaGFzaF9hbGdvcml0aG1zIjogWwogICAgICJzaGEyNTYiLAogICAgICJzaGE1MTIiCiAgICBdLAogICAgImtleXR5cGUiOiAiZWNkc2EiLAogICAgImtleXZhbCI6IHsKICAgICAicHVibGljIjogIi0tLS0tQkVHSU4gUFVCTElDIEtFWS0tLS0tXG5NRmt3RXdZSEtvWkl6ajBDQVFZSUtvWkl6ajBEQVFjRFFnQUVpbmlrU3NBUW1Za05lSDVlWXEvQ25JekxhYWNPXG54bFNhYXdRRE93cUt5L3RDcXhxNXh4UFNKYzIxSzRXSWhzOUd5T2tLZnp1ZVkzR0lMemNNSlo0Y1d3PT1cbi0tLS0tRU5EIFBVQkxJQyBLRVktLS0tLVxuIgogICAgfSwKICAgICJzY2hlbWUiOiAiZWNkc2Etc2hhMi1uaXN0cDI1NiIsCiAgICAieC10dWYtb24tY2kta2V5b3duZXIiOiAiQGJvYmNhbGxhd2F5IgogICB9LAogICAiYTY4N2U1YmY0ZmFiODJiMGVlNThkNDZlMDVjOTUzNTE0NWEyYzlhZmI0NThmNDNkNDJiNDVjYTBmZGNlMmE3MCI6IHsKICAgICJrZXlpZF9oYXNoX2FsZ29yaXRobXMiOiBbCiAgICAgInNoYTI1NiIsCiAgICAgInNoYTUxMiIKICAgIF0sCiAgICAia2V5dHlwZSI6ICJlY2RzYSIsCiAgICAia2V5dmFsIjogewogICAgICJwdWJsaWMiOiAiLS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS1cbk1Ga3dFd1lIS29aSXpqMENBUVlJS29aSXpqMERBUWNEUWdBRTBnaHJoOTJMdzFZcjNpZEdWNVdxQ3RNREI4Q3hcbitEOGhkQzR3MlpMTklwbFZSb1ZHTHNrWWEzZ2hlTXlPamlKOGtQaTE1YVEyLy83UCtvajdVdkpQR3c9PVxuLS0tLS1FTkQgUFVCTElDIEtFWS0tLS0tXG4iCiAgICB9LAogICAgInNjaGVtZSI6ICJlY2RzYS1zaGEyLW5pc3RwMjU2IiwKICAgICJ4LXR1Zi1vbi1jaS1rZXlvd25lciI6ICJAam9zaHVhZ2wiCiAgIH0sCiAgICJlNzFhNTRkNTQzODM1YmE4NmFkYWQ5NDYwMzc5Yzc2NDFmYjg3MjZkMTY0ZWE3NjY4MDFhMWM1MjJhYmE3ZWEyIjogewogICAgImtleWlkX2hhc2hfYWxnb3JpdGhtcyI6IFsKICAgICAic2hhMjU2IiwKICAgICAic2hhNTEyIgogICAgXSwKICAgICJrZXl0eXBlIjogImVjZHNhIiwKICAgICJrZXl2YWwiOiB7CiAgICAgInB1YmxpYyI6ICItLS0tLUJFR0lOIFBVQkxJQyBLRVktLS0tLVxuTUZrd0V3WUhLb1pJemowQ0FRWUlLb1pJemowREFRY0RRZ0FFRVhzejNTWlhGYjhqTVY0Mmo2cEpseWpialI4S1xuTjNCd29jZXhxNkxNSWI1cXNXS09RdkxOMTZOVWVmTGM0SHN3T291bVJzVlZhYWpTcFFTNmZvYmtSdz09XG4tLS0tLUVORCBQVUJMSUMgS0VZLS0tLS1cbiIKICAgIH0sCiAgICAic2NoZW1lIjogImVjZHNhLXNoYTItbmlzdHAyNTYiLAogICAgIngtdHVmLW9uLWNpLWtleW93bmVyIjogIkBtbm02NzgiCiAgIH0KICB9LAogICJyb2xlcyI6IHsKICAgInJvb3QiOiB7CiAgICAia2V5aWRzIjogWwogICAgICJlNzFhNTRkNTQzODM1YmE4NmFkYWQ5NDYwMzc5Yzc2NDFmYjg3MjZkMTY0ZWE3NjY4MDFhMWM1MjJhYmE3ZWEyIiwKICAgICAiMjJmNGNhZWM2ZDhlNmY5NTU1YWY2NmIzZDRjM2NiMDZhM2JiMjNmZGM3ZTM5YzkxNmM2MWY0NjJlNmY1MmIwNiIsCiAgICAgIjYxNjQzODM4MTI1YjQ0MGI0MGRiNjk0MmY1Y2I1YTMxYzBkYzA0MzY4MzE2ZWIyYWFhNThiOTU5MDRhNTgyMjIiLAogICAgICJhNjg3ZTViZjRmYWI4MmIwZWU1OGQ0NmUwNWM5NTM1MTQ1YTJjOWFmYjQ1OGY0M2Q0MmI0NWNhMGZkY2UyYTcwIiwKICAgICAiMTgzZTY0ZjM3NjcwZGMxM2NhMGQyODk5NWEzMDUzZjM3NDA5NTRkZGNlNDQzMjFhNDFlNDY1MzRjZjQ0ZTYzMiIKICAgIF0sCiAgICAidGhyZXNob2xkIjogMwogICB9LAogICAic25hcHNob3QiOiB7CiAgICAia2V5aWRzIjogWwogICAgICIwYzg3NDMyYzNiZjA5ZmQ5OTE4OWZkYzMyZmE1ZWFlZGY0ZTRhNWZhYzdiYWI3M2ZhMDRhMmUwZmM2NGFmNmY1IgogICAgXSwKICAgICJ0aHJlc2hvbGQiOiAxLAogICAgIngtdHVmLW9uLWNpLWV4cGlyeS1wZXJpb2QiOiAzNjUwLAogICAgIngtdHVmLW9uLWNpLXNpZ25pbmctcGVyaW9kIjogMzY1CiAgIH0sCiAgICJ0YXJnZXRzIjogewogICAgImtleWlkcyI6IFsKICAgICAiZTcxYTU0ZDU0MzgzNWJhODZhZGFkOTQ2MDM3OWM3NjQxZmI4NzI2ZDE2NGVhNzY2ODAxYTFjNTIyYWJhN2VhMiIsCiAgICAgIjIyZjRjYWVjNmQ4ZTZmOTU1NWFmNjZiM2Q0YzNjYjA2YTNiYjIzZmRjN2UzOWM5MTZjNjFmNDYyZTZmNTJiMDYiLAogICAgICI2MTY0MzgzODEyNWI0NDBiNDBkYjY5NDJmNWNiNWEzMWMwZGMwNDM2ODMxNmViMmFhYTU4Yjk1OTA0YTU4MjIyIiwKICAgICAiYTY4N2U1YmY0ZmFiODJiMGVlNThkNDZlMDVjOTUzNTE0NWEyYzlhZmI0NThmNDNkNDJiNDVjYTBmZGNlMmE3MCIsCiAgICAgIjE4M2U2NGYzNzY3MGRjMTNjYTBkMjg5OTVhMzA1M2YzNzQwOTU0ZGRjZTQ0MzIxYTQxZTQ2NTM0Y2Y0NGU2MzIiCiAgICBdLAogICAgInRocmVzaG9sZCI6IDMKICAgfSwKICAgInRpbWVzdGFtcCI6IHsKICAgICJrZXlpZHMiOiBbCiAgICAgIjBjODc0MzJjM2JmMDlmZDk5MTg5ZmRjMzJmYTVlYWVkZjRlNGE1ZmFjN2JhYjczZmEwNGEyZTBmYzY0YWY2ZjUiCiAgICBdLAogICAgInRocmVzaG9sZCI6IDEsCiAgICAieC10dWYtb24tY2ktZXhwaXJ5LXBlcmlvZCI6IDcsCiAgICAieC10dWYtb24tY2ktc2lnbmluZy1wZXJpb2QiOiA2CiAgIH0KICB9LAogICJzcGVjX3ZlcnNpb24iOiAiMS4wIiwKICAidmVyc2lvbiI6IDE1LAogICJ4LXR1Zi1vbi1jaS1leHBpcnktcGVyaW9kIjogMTk3LAogICJ4LXR1Zi1vbi1jaS1zaWduaW5nLXBlcmlvZCI6IDQ2CiB9Cn0=",
		targets: {
			"trusted_root.json": "ewogICJtZWRpYVR5cGUiOiAiYXBwbGljYXRpb24vdm5kLmRldi5zaWdzdG9yZS50cnVzdGVkcm9vdCtqc29uO3ZlcnNpb249MC4xIiwKICAidGxvZ3MiOiBbCiAgICB7CiAgICAgICJiYXNlVXJsIjogImh0dHBzOi8vcmVrb3Iuc2lnc3RvcmUuZGV2IiwKICAgICAgImhhc2hBbGdvcml0aG0iOiAiU0hBMl8yNTYiLAogICAgICAicHVibGljS2V5IjogewogICAgICAgICJyYXdCeXRlcyI6ICJNRmt3RXdZSEtvWkl6ajBDQVFZSUtvWkl6ajBEQVFjRFFnQUUyRzJZKzJ0YWJkVFY1QmNHaUJJeDBhOWZBRndya0JibUxTR3RrczRMM3FYNnlZWTB6dWZCbmhDOFVyL2l5NTVHaFdQLzlBL2JZMkxoQzMwTTkrUll0dz09IiwKICAgICAgICAia2V5RGV0YWlscyI6ICJQS0lYX0VDRFNBX1AyNTZfU0hBXzI1NiIsCiAgICAgICAgInZhbGlkRm9yIjogewogICAgICAgICAgInN0YXJ0IjogIjIwMjEtMDEtMTJUMTE6NTM6MjdaIgogICAgICAgIH0KICAgICAgfSwKICAgICAgImxvZ0lkIjogewogICAgICAgICJrZXlJZCI6ICJ3Tkk5YXRRR2x6K1ZXZk82TFJ5Z0g0UVVmWS84VzRSRndpVDVpNVdSZ0IwPSIKICAgICAgfQogICAgfSwKICAgIHsKICAgICAgImJhc2VVcmwiOiAiaHR0cHM6Ly9sb2cyMDI1LTEucmVrb3Iuc2lnc3RvcmUuZGV2IiwKICAgICAgImhhc2hBbGdvcml0aG0iOiAiU0hBMl8yNTYiLAogICAgICAicHVibGljS2V5IjogewogICAgICAgICJyYXdCeXRlcyI6ICJNQ293QlFZREsyVndBeUVBdDhybHAxa25Hd2pmYmNYQVlQWUFrbjBYaUx6MXg4TzR0MFlrRWhpZTI0ND0iLAogICAgICAgICJrZXlEZXRhaWxzIjogIlBLSVhfRUQyNTUxOSIsCiAgICAgICAgInZhbGlkRm9yIjogewogICAgICAgICAgInN0YXJ0IjogIjIwMjUtMDktMjNUMDA6MDA6MDBaIgogICAgICAgIH0KICAgICAgfSwKICAgICAgImxvZ0lkIjogewogICAgICAgICJrZXlJZCI6ICJ6eEdaRlZ2ZDBGRW1qUjhXckZ3TWRjQUo5dnRhWS9RWGY0NFkxd1VlUDZBPSIKICAgICAgfQogICAgfQogIF0sCiAgImNlcnRpZmljYXRlQXV0aG9yaXRpZXMiOiBbCiAgICB7CiAgICAgICJzdWJqZWN0IjogewogICAgICAgICJvcmdhbml6YXRpb24iOiAic2lnc3RvcmUuZGV2IiwKICAgICAgICAiY29tbW9uTmFtZSI6ICJzaWdzdG9yZSIKICAgICAgfSwKICAgICAgInVyaSI6ICJodHRwczovL2Z1bGNpby5zaWdzdG9yZS5kZXYiLAogICAgICAiY2VydENoYWluIjogewogICAgICAgICJjZXJ0aWZpY2F0ZXMiOiBbCiAgICAgICAgICB7CiAgICAgICAgICAgICJyYXdCeXRlcyI6ICJNSUlCK0RDQ0FYNmdBd0lCQWdJVE5Wa0Rab0Npb2ZQRHN5N2RmbTZnZUxidWh6QUtCZ2dxaGtqT1BRUURBekFxTVJVd0V3WURWUVFLRXd4emFXZHpkRzl5WlM1a1pYWXhFVEFQQmdOVkJBTVRDSE5wWjNOMGIzSmxNQjRYRFRJeE1ETXdOekF6TWpBeU9Wb1hEVE14TURJeU16QXpNakF5T1Zvd0tqRVZNQk1HQTFVRUNoTU1jMmxuYzNSdmNtVXVaR1YyTVJFd0R3WURWUVFERXdoemFXZHpkRzl5WlRCMk1CQUdCeXFHU000OUFnRUdCU3VCQkFBaUEySUFCTFN5QTdJaTVrK3BOTzhaRVdZMHlsZW1XRG93T2tOYTNrTCtHWkU1WjVHV2VoTDkvQTliUk5BM1JicnNaNWkwSmNhc3RhUkw3U3A1ZnAvakQ1ZHhxYy9VZFRWbmx2UzE2YW4rMllmc3dlL1F1TG9sUlVDcmNPRTIrMmlBNSt0emQ2Tm1NR1F3RGdZRFZSMFBBUUgvQkFRREFnRUdNQklHQTFVZEV3RUIvd1FJTUFZQkFmOENBUUV3SFFZRFZSME9CQllFRk1qRkhRQkJtaVFwTWxFazZ3MnVTdTFLQnRQc01COEdBMVVkSXdRWU1CYUFGTWpGSFFCQm1pUXBNbEVrNncydVN1MUtCdFBzTUFvR0NDcUdTTTQ5QkFNREEyZ0FNR1VDTUg4bGlXSmZNdWk2dlhYQmhqRGdZNE13c2xtTi9USnhWZS84M1dyRm9td21OZjA1NnkxWDQ4RjljNG0zYTNvelhBSXhBS2pSYXk1L2FqL2pzS0tHSWttUWF0akk4dXVwSHIvK0N4RnZhSldtcFlxTmtMREdSVSs5b3J6aDVoSTJScmN1YVE9PSIKICAgICAgICAgIH0KICAgICAgICBdCiAgICAgIH0sCiAgICAgICJ2YWxpZEZvciI6IHsKICAgICAgICAic3RhcnQiOiAiMjAyMS0wMy0wN1QwMzoyMDoyOVoiLAogICAgICAgICJlbmQiOiAiMjAyMi0xMi0zMVQyMzo1OTo1OS45OTlaIgogICAgICB9CiAgICB9LAogICAgewogICAgICAic3ViamVjdCI6IHsKICAgICAgICAib3JnYW5pemF0aW9uIjogInNpZ3N0b3JlLmRldiIsCiAgICAgICAgImNvbW1vbk5hbWUiOiAic2lnc3RvcmUiCiAgICAgIH0sCiAgICAgICJ1cmkiOiAiaHR0cHM6Ly9mdWxjaW8uc2lnc3RvcmUuZGV2IiwKICAgICAgImNlcnRDaGFpbiI6IHsKICAgICAgICAiY2VydGlmaWNhdGVzIjogWwogICAgICAgICAgewogICAgICAgICAgICAicmF3Qnl0ZXMiOiAiTUlJQ0dqQ0NBYUdnQXdJQkFnSVVBTG5WaVZmblUwYnJKYXNtUmtIcm4vVW5mYVF3Q2dZSUtvWkl6ajBFQXdNd0tqRVZNQk1HQTFVRUNoTU1jMmxuYzNSdmNtVXVaR1YyTVJFd0R3WURWUVFERXdoemFXZHpkRzl5WlRBZUZ3MHlNakEwTVRNeU1EQTJNVFZhRncwek1URXdNRFV4TXpVMk5UaGFNRGN4RlRBVEJnTlZCQW9UREhOcFozTjBiM0psTG1SbGRqRWVNQndHQTFVRUF4TVZjMmxuYzNSdmNtVXRhVzUwWlhKdFpXUnBZWFJsTUhZd0VBWUhLb1pJemowQ0FRWUZLNEVFQUNJRFlnQUU4UlZTL3lzSCtOT3Z1RFp5UEladGlsZ1VGOU5sYXJZcEFkOUhQMXZCQkgxVTVDVjc3TFNTN3MwWmlING5FN0h2N3B0UzZMdnZSL1NUazc5OExWZ016TGxKNEhlSWZGM3RIU2FleExjWXBTQVNyMWtTME4vUmdCSnovOWpXQ2lYbm8zc3dlVEFPQmdOVkhROEJBZjhFQkFNQ0FRWXdFd1lEVlIwbEJBd3dDZ1lJS3dZQkJRVUhBd013RWdZRFZSMFRBUUgvQkFnd0JnRUIvd0lCQURBZEJnTlZIUTRFRmdRVTM5UHB6MVlrRVpiNXFOanBLRldpeGk0WVpEOHdId1lEVlIwakJCZ3dGb0FVV01BZVg1RkZwV2FwZXN5UW9aTWkwQ3JGeGZvd0NnWUlLb1pJemowRUF3TURad0F3WkFJd1BDc1FLNERZaVpZRFBJYURpNUhGS25meFh4NkFTU1ZtRVJmc3luWUJpWDJYNlNKUm5aVTg0LzlEWmRuRnZ2eG1BakJPdDZRcEJsYzRKLzBEeHZrVENxcGNsdnppTDZCQ0NQbmpkbElCM1B1M0J4c1BteWdVWTdJaTJ6YmRDZGxpaW93PSIKICAgICAgICAgIH0sCiAgICAgICAgICB7CiAgICAgICAgICAgICJyYXdCeXRlcyI6ICJNSUlCOXpDQ0FYeWdBd0lCQWdJVUFMWk5BUEZkeEhQd2plRGxvRHd5WUNoQU8vNHdDZ1lJS29aSXpqMEVBd013S2pFVk1CTUdBMVVFQ2hNTWMybG5jM1J2Y21VdVpHVjJNUkV3RHdZRFZRUURFd2h6YVdkemRHOXlaVEFlRncweU1URXdNRGN4TXpVMk5UbGFGdzB6TVRFd01EVXhNelUyTlRoYU1Db3hGVEFUQmdOVkJBb1RESE5wWjNOMGIzSmxMbVJsZGpFUk1BOEdBMVVFQXhNSWMybG5jM1J2Y21Vd2RqQVFCZ2NxaGtqT1BRSUJCZ1VyZ1FRQUlnTmlBQVQ3WGVGVDRyYjNQUUd3UzRJYWp0TGszL09sbnBnYW5nYUJjbFlwc1lCcjVpKzR5bkIwN2NlYjNMUDBPSU9aZHhleFg2OWM1aVZ1eUpSUStIejA1eWkrVUYzdUJXQWxIcGlTNXNoMCtIMkdIRTdTWHJrMUVDNW0xVHIxOUw5Z2c5MmpZekJoTUE0R0ExVWREd0VCL3dRRUF3SUJCakFQQmdOVkhSTUJBZjhFQlRBREFRSC9NQjBHQTFVZERnUVdCQlJZd0I1ZmtVV2xacWw2ekpDaGt5TFFLc1hGK2pBZkJnTlZIU01FR0RBV2dCUll3QjVma1VXbFpxbDZ6SkNoa3lMUUtzWEYrakFLQmdncWhrak9QUVFEQXdOcEFEQm1BakVBajFuSGVYWnArMTNOV0JOYStFRHNEUDhHMVdXZzF0Q01XUC9XSFBxcGFWbzBqaHN3ZU5GWmdTczBlRTd3WUk0cUFqRUEyV0I5b3Q5OHNJa29GM3ZaWWRkMy9WdFdCNWI5VE5NZWE3SXgvc3RKNVRmY0xMZUFCTEU0Qk5KT3NRNHZuQkhKIgogICAgICAgICAgfQogICAgICAgIF0KICAgICAgfSwKICAgICAgInZhbGlkRm9yIjogewogICAgICAgICJzdGFydCI6ICIyMDIyLTA0LTEzVDIwOjA2OjE1WiIKICAgICAgfQogICAgfQogIF0sCiAgImN0bG9ncyI6IFsKICAgIHsKICAgICAgImJhc2VVcmwiOiAiaHR0cHM6Ly9jdGZlLnNpZ3N0b3JlLmRldi90ZXN0IiwKICAgICAgImhhc2hBbGdvcml0aG0iOiAiU0hBMl8yNTYiLAogICAgICAicHVibGljS2V5IjogewogICAgICAgICJyYXdCeXRlcyI6ICJNRmt3RXdZSEtvWkl6ajBDQVFZSUtvWkl6ajBEQVFjRFFnQUViZndSK1JKdWRYc2NnUkJScEtYMVhGRHkzUHl1ZER4ei9TZm5SaTFmVDhla3BmQmQyTzF1b3o3anIzWjhuS3p4QTY5RVVRK2VGQ0ZJM3pldWJQV1U3dz09IiwKICAgICAgICAia2V5RGV0YWlscyI6ICJQS0lYX0VDRFNBX1AyNTZfU0hBXzI1NiIsCiAgICAgICAgInZhbGlkRm9yIjogewogICAgICAgICAgInN0YXJ0IjogIjIwMjEtMDMtMTRUMDA6MDA6MDBaIiwKICAgICAgICAgICJlbmQiOiAiMjAyMi0xMC0zMVQyMzo1OTo1OS45OTlaIgogICAgICAgIH0KICAgICAgfSwKICAgICAgImxvZ0lkIjogewogICAgICAgICJrZXlJZCI6ICJDR0NTOENoUy8yaEYwZEZySjRTY1JXY1lyQlk5d3pqU2JlYThJZ1kyYjNJPSIKICAgICAgfQogICAgfSwKICAgIHsKICAgICAgImJhc2VVcmwiOiAiaHR0cHM6Ly9jdGZlLnNpZ3N0b3JlLmRldi8yMDIyIiwKICAgICAgImhhc2hBbGdvcml0aG0iOiAiU0hBMl8yNTYiLAogICAgICAicHVibGljS2V5IjogewogICAgICAgICJyYXdCeXRlcyI6ICJNRmt3RXdZSEtvWkl6ajBDQVFZSUtvWkl6ajBEQVFjRFFnQUVpUFNsRmkwQ21GVGZFakNVcUY5SHVDRWNZWE5LQWFZYWxJSm1CWjh5eWV6UGpUcWh4cktCcE1uYW9jVnRMSkJJMWVNM3VYblF6UUdBSmRKNGdzOUZ5dz09IiwKICAgICAgICAia2V5RGV0YWlscyI6ICJQS0lYX0VDRFNBX1AyNTZfU0hBXzI1NiIsCiAgICAgICAgInZhbGlkRm9yIjogewogICAgICAgICAgInN0YXJ0IjogIjIwMjItMTAtMjBUMDA6MDA6MDBaIgogICAgICAgIH0KICAgICAgfSwKICAgICAgImxvZ0lkIjogewogICAgICAgICJrZXlJZCI6ICIzVDB3YXNiSEVUSmpHUjRjbVdjM0FxSktYcmplUEszL2g0cHlnQzhwN280PSIKICAgICAgfQogICAgfQogIF0sCiAgInRpbWVzdGFtcEF1dGhvcml0aWVzIjogWwogICAgewogICAgICAic3ViamVjdCI6IHsKICAgICAgICAib3JnYW5pemF0aW9uIjogInNpZ3N0b3JlLmRldiIsCiAgICAgICAgImNvbW1vbk5hbWUiOiAic2lnc3RvcmUtdHNhLXNlbGZzaWduZWQiCiAgICAgIH0sCiAgICAgICJ1cmkiOiAiaHR0cHM6Ly90aW1lc3RhbXAuc2lnc3RvcmUuZGV2L2FwaS92MS90aW1lc3RhbXAiLAogICAgICAiY2VydENoYWluIjogewogICAgICAgICJjZXJ0aWZpY2F0ZXMiOiBbCiAgICAgICAgICB7CiAgICAgICAgICAgICJyYXdCeXRlcyI6ICJNSUlDRURDQ0FaYWdBd0lCQWdJVU9oTlVMd3lRWWU2OHdVTXZ5NHFPaXlvaml3d3dDZ1lJS29aSXpqMEVBd013T1RFVk1CTUdBMVVFQ2hNTWMybG5jM1J2Y21VdVpHVjJNU0F3SGdZRFZRUURFeGR6YVdkemRHOXlaUzEwYzJFdGMyVnNabk5wWjI1bFpEQWVGdzB5TlRBME1EZ3dOalU1TkROYUZ3MHpOVEEwTURZd05qVTVORE5hTUM0eEZUQVRCZ05WQkFvVERITnBaM04wYjNKbExtUmxkakVWTUJNR0ExVUVBeE1NYzJsbmMzUnZjbVV0ZEhOaE1IWXdFQVlIS29aSXpqMENBUVlGSzRFRUFDSURZZ0FFNHJhMlo4aEtOaWcyVDlrRmpDQVRvR0czMGpreStXUXYzQnpMK21LdmgxU0tOUi9Vd3V3c2ZOQ2c0c3J5b1lBZDhFNmlzb3ZWQTNNNGFvTmRtOVFEaTUwWjhuVEV5dnFnZkRQdFRJd1hJdGZpVy9BRmYxVjd1d2tia0FvajB4eGNvMm93YURBT0JnTlZIUThCQWY4RUJBTUNCNEF3SFFZRFZSME9CQllFRkluOWVVT0h6OUJsUnNNQ1JzY3NjMXQ5dE9zRE1COEdBMVVkSXdRWU1CYUFGSmpzQWU5L3UxSC8xSlVlYjRxSW1GTUhpYzYvTUJZR0ExVWRKUUVCL3dRTU1Bb0dDQ3NHQVFVRkJ3TUlNQW9HQ0NxR1NNNDlCQU1EQTJnQU1HVUNNRHRwc1YvNkthTzBxeUYvVU1zWDJhU1VYS1FGZG9HVHB0UUdjMGZ0cTFjc3VsSFBHRzZkc215TU5kM0pCK0czRVFJeEFPYWp2QmNqcEptS2I0TnYrMlRhb2o4VWM1K2I2aWg2RlhDQ0tyYVNxdXBlMDd6cXN3TWNYSlRlMWNFeHZIdnZsdz09IgogICAgICAgICAgfSwKICAgICAgICAgIHsKICAgICAgICAgICAgInJhd0J5dGVzIjogIk1JSUI5ekNDQVh5Z0F3SUJBZ0lVVjdmMEdMRE9vRXpJaDhMWFNXODBPSmlVcDE0d0NnWUlLb1pJemowRUF3TXdPVEVWTUJNR0ExVUVDaE1NYzJsbmMzUnZjbVV1WkdWMk1TQXdIZ1lEVlFRREV4ZHphV2R6ZEc5eVpTMTBjMkV0YzJWc1puTnBaMjVsWkRBZUZ3MHlOVEEwTURnd05qVTVORE5hRncwek5UQTBNRFl3TmpVNU5ETmFNRGt4RlRBVEJnTlZCQW9UREhOcFozTjBiM0psTG1SbGRqRWdNQjRHQTFVRUF4TVhjMmxuYzNSdmNtVXRkSE5oTFhObGJHWnphV2R1WldRd2RqQVFCZ2NxaGtqT1BRSUJCZ1VyZ1FRQUlnTmlBQVFVUU50ZlJUL291M1lBVGE2d0Iva0tUZTcwY2ZKd3lSSUJvdk1udDhSY0pwaC9DT0U4MnV5UzZGbXBwTExMMVZCUEdjUGZwUVBZSk5Yeld3aThpY3doS1E2Vy9RZTJoM29lYkJiMkZIcHdOSkRxbytUTWFDL3RkZmt2L0VsSkI3MmpSVEJETUE0R0ExVWREd0VCL3dRRUF3SUJCakFTQmdOVkhSTUJBZjhFQ0RBR0FRSC9BZ0VBTUIwR0ExVWREZ1FXQkJTWTdBSHZmN3RSLzlTVkhtK0tpSmhUQjRuT3Z6QUtCZ2dxaGtqT1BRUURBd05wQURCbUFqRUF3R0VHcmZHWlIxY2VuMVI4L0RUVk1JOTQzTHNzWm1KUnREcC9pN1NmR0htR1JQNmdSYnVqOXZPSzNiNjdaMFFRQWpFQXVUMkg2NzNMUUVhSFRjeVFTWnJrcDRtWDdXd2ttRitzVmJrWVk1bVhOK1JNSDEzS1VFSEhPcUFTYWVtWVdLL0UiCiAgICAgICAgICB9CiAgICAgICAgXQogICAgICB9LAogICAgICAidmFsaWRGb3IiOiB7CiAgICAgICAgInN0YXJ0IjogIjIwMjUtMDctMDRUMDA6MDA6MDBaIgogICAgICB9CiAgICB9CiAgXQp9Cg==",
			"registry.npmjs.org%2Fkeys.json": "ewogICAgImtleXMiOiBbCiAgICAgICAgewogICAgICAgICAgICAia2V5SWQiOiAiU0hBMjU2OmpsM2J3c3d1ODBQampva0NnaDBvMnc1YzJVNExoUUFFNTdnajljejFrekEiLAogICAgICAgICAgICAia2V5VXNhZ2UiOiAibnBtOnNpZ25hdHVyZXMiLAogICAgICAgICAgICAicHVibGljS2V5IjogewogICAgICAgICAgICAgICAgInJhd0J5dGVzIjogIk1Ga3dFd1lIS29aSXpqMENBUVlJS29aSXpqMERBUWNEUWdBRTFPbGIzek1BRkZ4WEtIaUlrUU81Y0ozWWhsNWk2VVBwK0lodXRlQkpidUhjQTVVb2dLbzBFV3RsV3dXNktTYUtvVE5FWUw3SmxDUWlWbmtoQmt0VWdnPT0iLAogICAgICAgICAgICAgICAgImtleURldGFpbHMiOiAiUEtJWF9FQ0RTQV9QMjU2X1NIQV8yNTYiLAogICAgICAgICAgICAgICAgInZhbGlkRm9yIjogewogICAgICAgICAgICAgICAgICAgICJzdGFydCI6ICIxOTk5LTAxLTAxVDAwOjAwOjAwLjAwMFoiLAogICAgICAgICAgICAgICAgICAgICJlbmQiOiAiMjAyNS0wMS0yOVQwMDowMDowMC4wMDBaIgogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgfSwKICAgICAgICB7CiAgICAgICAgICAgICJrZXlJZCI6ICJTSEEyNTY6amwzYndzd3U4MFBqam9rQ2doMG8ydzVjMlU0TGhRQUU1N2dqOWN6MWt6QSIsCiAgICAgICAgICAgICJrZXlVc2FnZSI6ICJucG06YXR0ZXN0YXRpb25zIiwKICAgICAgICAgICAgInB1YmxpY0tleSI6IHsKICAgICAgICAgICAgICAgICJyYXdCeXRlcyI6ICJNRmt3RXdZSEtvWkl6ajBDQVFZSUtvWkl6ajBEQVFjRFFnQUUxT2xiM3pNQUZGeFhLSGlJa1FPNWNKM1lobDVpNlVQcCtJaHV0ZUJKYnVIY0E1VW9nS28wRVd0bFd3VzZLU2FLb1RORVlMN0psQ1FpVm5raEJrdFVnZz09IiwKICAgICAgICAgICAgICAgICJrZXlEZXRhaWxzIjogIlBLSVhfRUNEU0FfUDI1Nl9TSEFfMjU2IiwKICAgICAgICAgICAgICAgICJ2YWxpZEZvciI6IHsKICAgICAgICAgICAgICAgICAgICAic3RhcnQiOiAiMjAyMi0xMi0wMVQwMDowMDowMC4wMDBaIiwKICAgICAgICAgICAgICAgICAgICAiZW5kIjogIjIwMjUtMDEtMjlUMDA6MDA6MDAuMDAwWiIKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfQogICAgICAgIH0sCiAgICAgICAgewogICAgICAgICAgICAia2V5SWQiOiAiU0hBMjU2OkRoUTh3UjVBUEJ2RkhMRi8rVGMrQVl2UE9kVHBjSURxT2h4c0JIUndDN1UiLAogICAgICAgICAgICAia2V5VXNhZ2UiOiAibnBtOnNpZ25hdHVyZXMiLAogICAgICAgICAgICAicHVibGljS2V5IjogewogICAgICAgICAgICAgICAgInJhd0J5dGVzIjogIk1Ga3dFd1lIS29aSXpqMENBUVlJS29aSXpqMERBUWNEUWdBRVk2WWE3VysrN2FVUHp2TVRyZXpINlljeDNjK0hPS1lDY05HeWJKWlNDSnEvZmQ3UWE4dXVBS3RkSWtVUXRRaUVLRVJoQW1FNWxNTUpoUDhPa0RPYTJnPT0iLAogICAgICAgICAgICAgICAgImtleURldGFpbHMiOiAiUEtJWF9FQ0RTQV9QMjU2X1NIQV8yNTYiLAogICAgICAgICAgICAgICAgInZhbGlkRm9yIjogewogICAgICAgICAgICAgICAgICAgICJzdGFydCI6ICIyMDI1LTAxLTEzVDAwOjAwOjAwLjAwMFoiCiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0KICAgICAgICB9LAogICAgICAgIHsKICAgICAgICAgICAgImtleUlkIjogIlNIQTI1NjpEaFE4d1I1QVBCdkZITEYvK1RjK0FZdlBPZFRwY0lEcU9oeHNCSFJ3QzdVIiwKICAgICAgICAgICAgImtleVVzYWdlIjogIm5wbTphdHRlc3RhdGlvbnMiLAogICAgICAgICAgICAicHVibGljS2V5IjogewogICAgICAgICAgICAgICAgInJhd0J5dGVzIjogIk1Ga3dFd1lIS29aSXpqMENBUVlJS29aSXpqMERBUWNEUWdBRVk2WWE3VysrN2FVUHp2TVRyZXpINlljeDNjK0hPS1lDY05HeWJKWlNDSnEvZmQ3UWE4dXVBS3RkSWtVUXRRaUVLRVJoQW1FNWxNTUpoUDhPa0RPYTJnPT0iLAogICAgICAgICAgICAgICAgImtleURldGFpbHMiOiAiUEtJWF9FQ0RTQV9QMjU2X1NIQV8yNTYiLAogICAgICAgICAgICAgICAgInZhbGlkRm9yIjogewogICAgICAgICAgICAgICAgICAgICJzdGFydCI6ICIyMDI1LTAxLTEzVDAwOjAwOjAwLjAwMFoiCiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICBdCn0K"
		}
	} };
})), require_client = __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.TUFClient = void 0;
	let fs_1 = __importDefault(require("fs")), path_1 = __importDefault(require("path")), tuf_js_1 = require_dist$3(), _1 = require_dist$2(), package_json_1 = require_package(), target_1 = require_target(), TARGETS_DIR_NAME = "targets";
	exports.TUFClient = class {
		updater;
		constructor(options) {
			let url = new URL(options.mirrorURL), repoName = encodeURIComponent(url.host + url.pathname.replace(/\/$/, "")), cachePath = path_1.default.join(options.cachePath, repoName);
			initTufCache(cachePath), seedCache({
				cachePath,
				mirrorURL: options.mirrorURL,
				tufRootPath: options.rootPath,
				forceInit: options.forceInit
			}), this.updater = initClient({
				mirrorURL: options.mirrorURL,
				cachePath,
				forceCache: options.forceCache,
				retry: options.retry,
				timeout: options.timeout
			});
		}
		async refresh() {
			return this.updater.refresh();
		}
		getTarget(targetName) {
			return (0, target_1.readTarget)(this.updater, targetName);
		}
	};
	function initTufCache(cachePath) {
		let targetsPath = path_1.default.join(cachePath, TARGETS_DIR_NAME);
		fs_1.default.existsSync(cachePath) || fs_1.default.mkdirSync(cachePath, { recursive: !0 }), fs_1.default.existsSync(targetsPath) || fs_1.default.mkdirSync(targetsPath);
	}
	function seedCache({ cachePath, mirrorURL, tufRootPath, forceInit }) {
		let cachedRootPath = path_1.default.join(cachePath, "root.json");
		if (!fs_1.default.existsSync(cachedRootPath) || forceInit) {
			if (tufRootPath) fs_1.default.copyFileSync(tufRootPath, cachedRootPath);
			else {
				let repoSeed = require_seeds()[mirrorURL];
				if (!repoSeed) throw new _1.TUFError({
					code: "TUF_INIT_CACHE_ERROR",
					message: `No root.json found for mirror: ${mirrorURL}`
				});
				fs_1.default.writeFileSync(cachedRootPath, Buffer.from(repoSeed["root.json"], "base64")), Object.entries(repoSeed.targets).forEach(([targetName, target]) => {
					fs_1.default.writeFileSync(path_1.default.join(cachePath, TARGETS_DIR_NAME, targetName), Buffer.from(target, "base64"));
				});
			}
		}
	}
	function initClient(options) {
		let config = {
			fetchTimeout: options.timeout,
			fetchRetry: options.retry,
			userAgent: `${encodeURIComponent(package_json_1.name)}/${package_json_1.version}`
		};
		return new tuf_js_1.Updater({
			metadataBaseUrl: options.mirrorURL,
			targetBaseUrl: `${options.mirrorURL}/targets`,
			metadataDir: options.cachePath,
			targetDir: path_1.default.join(options.cachePath, TARGETS_DIR_NAME),
			forceCache: options.forceCache,
			config
		});
	}
})), require_dist$2 = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.TUFError = exports.DEFAULT_MIRROR_URL = void 0, exports.getTrustedRoot = getTrustedRoot, exports.initTUF = initTUF;
	let protobuf_specs_1 = require_dist$6(), appdata_1 = require_appdata(), client_1 = require_client();
	exports.DEFAULT_MIRROR_URL = "https://tuf-repo-cdn.sigstore.dev";
	let DEFAULT_RETRY = { retries: 2 };
	async function getTrustedRoot(options = {}) {
		let trustedRoot = await createClient(options).getTarget("trusted_root.json");
		return protobuf_specs_1.TrustedRoot.fromJSON(JSON.parse(trustedRoot));
	}
	async function initTUF(options = {}) {
		let client = createClient(options);
		return client.refresh().then(() => client);
	}
	function createClient(options) {
		return new client_1.TUFClient({
			cachePath: options.cachePath || (0, appdata_1.appDataPath)("sigstore-js"),
			rootPath: options.rootPath,
			mirrorURL: options.mirrorURL || exports.DEFAULT_MIRROR_URL,
			retry: options.retry ?? DEFAULT_RETRY,
			timeout: options.timeout ?? 5e3,
			forceCache: options.forceCache ?? !1,
			forceInit: options.forceInit ?? options.force ?? !1
		});
	}
	var error_1 = require_error$3();
	Object.defineProperty(exports, "TUFError", {
		enumerable: !0,
		get: function() {
			return error_1.TUFError;
		}
	});
})), require_stream = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.ByteStream = void 0;
	var StreamError = class extends Error {};
	exports.ByteStream = class ByteStream {
		static BLOCK_SIZE = 1024;
		buf;
		view;
		start = 0;
		constructor(buffer) {
			buffer ? (this.buf = buffer, this.view = Buffer.from(buffer)) : (this.buf = Buffer.alloc(0), this.view = Buffer.from(this.buf));
		}
		get buffer() {
			return this.view.subarray(0, this.start);
		}
		get length() {
			return this.view.byteLength;
		}
		get position() {
			return this.start;
		}
		seek(position) {
			this.start = position;
		}
		slice(start, len) {
			let end = start + len;
			if (end > this.length) throw new StreamError("request past end of buffer");
			return this.view.subarray(start, end);
		}
		appendChar(char) {
			this.ensureCapacity(1), this.view[this.start] = char, this.start += 1;
		}
		appendUint16(num) {
			this.ensureCapacity(2);
			let value = new Uint16Array([num]), view = new Uint8Array(value.buffer);
			this.view[this.start] = view[1], this.view[this.start + 1] = view[0], this.start += 2;
		}
		appendUint24(num) {
			this.ensureCapacity(3);
			let value = new Uint32Array([num]), view = new Uint8Array(value.buffer);
			this.view[this.start] = view[2], this.view[this.start + 1] = view[1], this.view[this.start + 2] = view[0], this.start += 3;
		}
		appendView(view) {
			this.ensureCapacity(view.length), this.view.set(view, this.start), this.start += view.length;
		}
		getBlock(size) {
			if (size <= 0) return Buffer.alloc(0);
			if (this.start + size > this.view.length) throw Error("request past end of buffer");
			let result = this.view.subarray(this.start, this.start + size);
			return this.start += size, result;
		}
		getUint8() {
			return this.getBlock(1)[0];
		}
		getUint16() {
			let block = this.getBlock(2);
			return block[0] << 8 | block[1];
		}
		ensureCapacity(size) {
			if (this.start + size > this.view.byteLength) {
				let blockSize = ByteStream.BLOCK_SIZE + (size > ByteStream.BLOCK_SIZE ? size : 0);
				this.realloc(this.view.byteLength + blockSize);
			}
		}
		realloc(size) {
			let newArray = Buffer.alloc(size), newView = Buffer.from(newArray);
			newView.set(this.view), this.buf = newArray, this.view = newView;
		}
	};
})), require_error$2 = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.ASN1TypeError = exports.ASN1ParseError = void 0, exports.ASN1ParseError = class extends Error {}, exports.ASN1TypeError = class extends Error {};
})), require_length = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.decodeLength = decodeLength, exports.encodeLength = encodeLength;
	let error_1 = require_error$2();
	function decodeLength(stream) {
		let buf = stream.getUint8();
		if (!(buf & 128)) return buf;
		let byteCount = buf & 127;
		if (byteCount > 6) throw new error_1.ASN1ParseError("length exceeds 6 byte limit");
		let len = 0;
		for (let i = 0; i < byteCount; i++) {
			let byte = stream.getUint8();
			if (i === 0 && byte === 0) throw new error_1.ASN1ParseError("non-minimal length encoding");
			len = len * 256 + byte;
		}
		if (len === 0) throw new error_1.ASN1ParseError("indefinite length encoding not supported");
		if (len < 128) throw new error_1.ASN1ParseError("non-minimal length encoding");
		return len;
	}
	function encodeLength(len) {
		if (len < 128) return Buffer.from([len]);
		let val = BigInt(len), bytes = [];
		for (; val > 0n;) bytes.unshift(Number(val & 255n)), val >>= 8n;
		return Buffer.from([128 | bytes.length, ...bytes]);
	}
})), require_parse = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.parseInteger = parseInteger, exports.parseStringASCII = parseStringASCII, exports.parseTime = parseTime, exports.parseOID = parseOID, exports.parseBoolean = parseBoolean, exports.parseBitString = parseBitString;
	let error_1 = require_error$2(), RE_TIME_SHORT_YEAR = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\.\d{3})?Z$/, RE_TIME_LONG_YEAR = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\.\d{3})?Z$/;
	function parseInteger(buf) {
		let pos = 0, end = buf.length, val = buf[pos], neg = val > 127, pad = neg ? 255 : 0;
		for (; val == pad && ++pos < end;) val = buf[pos];
		if (end - pos === 0) return BigInt(neg ? -1 : 0);
		val = neg ? val - 256 : val;
		let n = BigInt(val);
		for (let i = pos + 1; i < end; ++i) n = n * BigInt(256) + BigInt(buf[i]);
		return n;
	}
	function parseStringASCII(buf) {
		return buf.toString("ascii");
	}
	function parseTime(buf, shortYear) {
		let timeStr = parseStringASCII(buf), m = shortYear ? RE_TIME_SHORT_YEAR.exec(timeStr) : RE_TIME_LONG_YEAR.exec(timeStr);
		if (!m) throw Error("invalid time");
		if (shortYear) {
			let year = Number(m[1]);
			year += year >= 50 ? 1900 : 2e3, m[1] = year.toString();
		}
		return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
	}
	function parseOID(buf) {
		let pos = 0, end = buf.length, n = buf[pos++], oid = `${Math.floor(n / 40)}.${n % 40}`, val = 0n;
		for (; pos < end; ++pos) n = buf[pos], val = (val << 7n) + BigInt(n & 127), n & 128 || (oid += `.${val}`, val = 0n);
		return oid;
	}
	function parseBoolean(buf) {
		if (buf.length !== 1) throw new error_1.ASN1ParseError("invalid boolean");
		switch (buf[0]) {
			case 0: return !1;
			case 255: return !0;
			default: throw new error_1.ASN1ParseError("invalid boolean");
		}
	}
	function parseBitString(buf) {
		let unused = buf[0];
		if (unused > 7) throw new error_1.ASN1ParseError("invalid bit string");
		let end = buf.length, bits = [];
		for (let i = 1; i < end; ++i) {
			let byte = buf[i], skip = i === end - 1 ? unused : 0;
			for (let j = 7; j >= skip; --j) bits.push(byte >> j & 1);
		}
		return bits;
	}
})), require_tag = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.ASN1Tag = void 0;
	let error_1 = require_error$2(), UNIVERSAL_TAG = {
		BOOLEAN: 1,
		INTEGER: 2,
		BIT_STRING: 3,
		OCTET_STRING: 4,
		OBJECT_IDENTIFIER: 6,
		SEQUENCE: 16,
		SET: 17,
		PRINTABLE_STRING: 19,
		UTC_TIME: 23,
		GENERALIZED_TIME: 24
	}, TAG_CLASS = {
		UNIVERSAL: 0,
		APPLICATION: 1,
		CONTEXT_SPECIFIC: 2,
		PRIVATE: 3
	};
	exports.ASN1Tag = class {
		number;
		constructed;
		class;
		constructor(enc) {
			if (this.number = enc & 31, this.constructed = (enc & 32) == 32, this.class = enc >> 6, this.number === 31) throw new error_1.ASN1ParseError("long form tags not supported");
			if (this.class === TAG_CLASS.UNIVERSAL && this.number === 0) throw new error_1.ASN1ParseError("unsupported tag 0x00");
		}
		isUniversal() {
			return this.class === TAG_CLASS.UNIVERSAL;
		}
		isContextSpecific(num) {
			let res = this.class === TAG_CLASS.CONTEXT_SPECIFIC;
			return num === void 0 ? res : res && this.number === num;
		}
		isBoolean() {
			return this.isUniversal() && this.number === UNIVERSAL_TAG.BOOLEAN;
		}
		isInteger() {
			return this.isUniversal() && this.number === UNIVERSAL_TAG.INTEGER;
		}
		isBitString() {
			return this.isUniversal() && this.number === UNIVERSAL_TAG.BIT_STRING;
		}
		isOctetString() {
			return this.isUniversal() && this.number === UNIVERSAL_TAG.OCTET_STRING;
		}
		isOID() {
			return this.isUniversal() && this.number === UNIVERSAL_TAG.OBJECT_IDENTIFIER;
		}
		isUTCTime() {
			return this.isUniversal() && this.number === UNIVERSAL_TAG.UTC_TIME;
		}
		isGeneralizedTime() {
			return this.isUniversal() && this.number === UNIVERSAL_TAG.GENERALIZED_TIME;
		}
		toDER() {
			return this.number | (this.constructed ? 32 : 0) | this.class << 6;
		}
	};
})), require_obj = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.ASN1Obj = void 0;
	let stream_1 = require_stream(), error_1 = require_error$2(), length_1 = require_length(), parse_1 = require_parse(), tag_1 = require_tag();
	var ASN1Obj = class {
		tag;
		subs;
		value;
		constructor(tag, value, subs) {
			this.tag = tag, this.value = value, this.subs = subs;
		}
		static parseBuffer(buf) {
			let stream = new stream_1.ByteStream(buf), obj = parseStream(stream);
			if (stream.position !== stream.length) throw new error_1.ASN1ParseError("invalid trailing data");
			return obj;
		}
		toDER() {
			let valueStream = new stream_1.ByteStream();
			if (this.subs.length > 0) for (let sub of this.subs) valueStream.appendView(sub.toDER());
			else valueStream.appendView(this.value);
			let value = valueStream.buffer, obj = new stream_1.ByteStream();
			return obj.appendChar(this.tag.toDER()), obj.appendView((0, length_1.encodeLength)(value.length)), obj.appendView(value), obj.buffer;
		}
		toBoolean() {
			if (!this.tag.isBoolean()) throw new error_1.ASN1TypeError("not a boolean");
			return (0, parse_1.parseBoolean)(this.value);
		}
		toInteger() {
			if (!this.tag.isInteger()) throw new error_1.ASN1TypeError("not an integer");
			return (0, parse_1.parseInteger)(this.value);
		}
		toOID() {
			if (!this.tag.isOID()) throw new error_1.ASN1TypeError("not an OID");
			return (0, parse_1.parseOID)(this.value);
		}
		toDate() {
			switch (!0) {
				case this.tag.isUTCTime(): return (0, parse_1.parseTime)(this.value, !0);
				case this.tag.isGeneralizedTime(): return (0, parse_1.parseTime)(this.value, !1);
				default: throw new error_1.ASN1TypeError("not a date");
			}
		}
		toBitString() {
			if (!this.tag.isBitString()) throw new error_1.ASN1TypeError("not a bit string");
			return (0, parse_1.parseBitString)(this.value);
		}
	};
	exports.ASN1Obj = ASN1Obj;
	function parseStream(stream, depth = 0) {
		if (depth > 100) throw new error_1.ASN1ParseError("maximum nesting depth exceeded");
		let tag = new tag_1.ASN1Tag(stream.getUint8()), len = (0, length_1.decodeLength)(stream), value = stream.slice(stream.position, len), start = stream.position, subs = [];
		if (tag.constructed) subs = collectSubs(stream, len, depth);
		else if (tag.isOctetString()) try {
			subs = collectSubs(stream, len, depth);
		} catch {}
		return subs.length === 0 && stream.seek(start + len), new ASN1Obj(tag, value, subs);
	}
	function collectSubs(stream, len, depth) {
		let end = stream.position + len;
		if (end > stream.length) throw new error_1.ASN1ParseError("invalid length");
		let subs = [];
		for (; stream.position < end;) subs.push(parseStream(stream, depth + 1));
		if (stream.position !== end) throw new error_1.ASN1ParseError("invalid length");
		return subs;
	}
})), require_asn1 = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.ASN1Obj = void 0;
	var obj_1 = require_obj();
	Object.defineProperty(exports, "ASN1Obj", {
		enumerable: !0,
		get: function() {
			return obj_1.ASN1Obj;
		}
	});
})), require_crypto = __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.createPublicKey = createPublicKey, exports.digest = digest, exports.verify = verify, exports.bufferEqual = bufferEqual;
	let crypto_1 = __importDefault(require("crypto"));
	function createPublicKey(key, type = "spki") {
		return typeof key == "string" ? key.startsWith("-----") ? crypto_1.default.createPublicKey(key) : crypto_1.default.createPublicKey({
			key: Buffer.from(key, "base64"),
			format: "der",
			type
		}) : crypto_1.default.createPublicKey({
			key,
			format: "der",
			type
		});
	}
	function digest(algorithm, ...data) {
		let hash = crypto_1.default.createHash(algorithm);
		for (let d of data) hash.update(d);
		return hash.digest();
	}
	function verify(data, key, signature, algorithm) {
		try {
			return crypto_1.default.verify(algorithm, data, key, signature);
		} catch {
			return !1;
		}
	}
	function bufferEqual(a, b) {
		try {
			return crypto_1.default.timingSafeEqual(a, b);
		} catch {
			return !1;
		}
	}
})), require_dsse$3 = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.preAuthEncoding = preAuthEncoding;
	function preAuthEncoding(payloadType, payload) {
		let typeBytes = Buffer.from(payloadType, "utf-8");
		return Buffer.concat([
			Buffer.from(`DSSEv1 ${typeBytes.length} `, "ascii"),
			typeBytes,
			Buffer.from(` ${payload.length} `, "ascii"),
			payload
		]);
	}
})), require_encoding = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.base64Encode = base64Encode, exports.base64Decode = base64Decode;
	let BASE64_ENCODING = "base64", UTF8_ENCODING = "utf-8";
	function base64Encode(str) {
		return Buffer.from(str, UTF8_ENCODING).toString(BASE64_ENCODING);
	}
	function base64Decode(str) {
		return Buffer.from(str, BASE64_ENCODING).toString(UTF8_ENCODING);
	}
})), require_json = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.canonicalize = canonicalize;
	function canonicalize(object) {
		let buffer = "";
		if (typeof object != "object" || !object || object.toJSON != null) buffer += JSON.stringify(object);
		else if (Array.isArray(object)) {
			buffer += "[";
			let first = !0;
			object.forEach((element) => {
				first || (buffer += ","), first = !1, buffer += canonicalize(element);
			}), buffer += "]";
		} else {
			buffer += "{";
			let first = !0;
			Object.keys(object).sort().forEach((property) => {
				first || (buffer += ","), first = !1, buffer += JSON.stringify(property), buffer += ":", buffer += canonicalize(object[property]);
			}), buffer += "}";
		}
		return buffer;
	}
})), require_pem = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.toDER = toDER, exports.fromDER = fromDER;
	let PEM_HEADER = /-----BEGIN (.*)-----/, PEM_FOOTER = /-----END (.*)-----/;
	function toDER(certificate) {
		let der = "";
		return certificate.split("\n").forEach((line) => {
			line.match(PEM_HEADER) || line.match(PEM_FOOTER) || (der += line);
		}), Buffer.from(der, "base64");
	}
	function fromDER(certificate, type = "CERTIFICATE") {
		let lines = certificate.toString("base64").match(/.{1,64}/g) || "";
		return [
			`-----BEGIN ${type}-----`,
			...lines,
			`-----END ${type}-----`
		].join("\n").concat("\n");
	}
})), require_oid = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.SHA2_HASH_ALGOS = exports.RSA_SIGNATURE_ALGOS = exports.ECDSA_SIGNATURE_ALGOS = void 0, exports.ECDSA_SIGNATURE_ALGOS = {
		"1.2.840.10045.4.3.1": "sha224",
		"1.2.840.10045.4.3.2": "sha256",
		"1.2.840.10045.4.3.3": "sha384",
		"1.2.840.10045.4.3.4": "sha512"
	}, exports.RSA_SIGNATURE_ALGOS = {
		"1.2.840.113549.1.1.14": "sha224",
		"1.2.840.113549.1.1.11": "sha256",
		"1.2.840.113549.1.1.12": "sha384",
		"1.2.840.113549.1.1.13": "sha512"
	}, exports.SHA2_HASH_ALGOS = {
		"2.16.840.1.101.3.4.2.1": "sha256",
		"2.16.840.1.101.3.4.2.2": "sha384",
		"2.16.840.1.101.3.4.2.3": "sha512"
	};
})), require_error$1 = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.RFC3161TimestampVerificationError = void 0, exports.RFC3161TimestampVerificationError = class extends Error {};
})), require_tstinfo = __commonJSMin(((exports) => {
	var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k);
		var desc = Object.getOwnPropertyDescriptor(m, k);
		(!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) && (desc = {
			enumerable: !0,
			get: function() {
				return m[k];
			}
		}), Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k), o[k2] = m[k];
	})), __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
		Object.defineProperty(o, "default", {
			enumerable: !0,
			value: v
		});
	}) : function(o, v) {
		o.default = v;
	}), __importStar = exports && exports.__importStar || (function() {
		var ownKeys = function(o) {
			return ownKeys = Object.getOwnPropertyNames || function(o) {
				var ar = [];
				for (var k in o) Object.prototype.hasOwnProperty.call(o, k) && (ar[ar.length] = k);
				return ar;
			}, ownKeys(o);
		};
		return function(mod) {
			if (mod && mod.__esModule) return mod;
			var result = {};
			if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) k[i] !== "default" && __createBinding(result, mod, k[i]);
			return __setModuleDefault(result, mod), result;
		};
	})();
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.TSTInfo = void 0;
	let crypto = __importStar(require_crypto()), oid_1 = require_oid(), error_1 = require_error$1();
	exports.TSTInfo = class {
		root;
		constructor(asn1) {
			this.root = asn1;
		}
		get version() {
			return this.root.subs[0].toInteger();
		}
		get genTime() {
			return this.root.subs[4].toDate();
		}
		get messageImprintHashAlgorithm() {
			let oid = this.messageImprintObj.subs[0].subs[0].toOID();
			return oid_1.SHA2_HASH_ALGOS[oid];
		}
		get messageImprintHashedMessage() {
			return this.messageImprintObj.subs[1].value;
		}
		get raw() {
			return this.root.toDER();
		}
		verify(data) {
			let digest = crypto.digest(this.messageImprintHashAlgorithm, data);
			if (!crypto.bufferEqual(digest, this.messageImprintHashedMessage)) throw new error_1.RFC3161TimestampVerificationError("message imprint does not match artifact");
		}
		get messageImprintObj() {
			return this.root.subs[2];
		}
	};
})), require_timestamp$1 = __commonJSMin(((exports) => {
	var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k);
		var desc = Object.getOwnPropertyDescriptor(m, k);
		(!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) && (desc = {
			enumerable: !0,
			get: function() {
				return m[k];
			}
		}), Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k), o[k2] = m[k];
	})), __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
		Object.defineProperty(o, "default", {
			enumerable: !0,
			value: v
		});
	}) : function(o, v) {
		o.default = v;
	}), __importStar = exports && exports.__importStar || (function() {
		var ownKeys = function(o) {
			return ownKeys = Object.getOwnPropertyNames || function(o) {
				var ar = [];
				for (var k in o) Object.prototype.hasOwnProperty.call(o, k) && (ar[ar.length] = k);
				return ar;
			}, ownKeys(o);
		};
		return function(mod) {
			if (mod && mod.__esModule) return mod;
			var result = {};
			if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) k[i] !== "default" && __createBinding(result, mod, k[i]);
			return __setModuleDefault(result, mod), result;
		};
	})();
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.RFC3161Timestamp = void 0;
	let asn1_1 = require_asn1(), crypto = __importStar(require_crypto()), oid_1 = require_oid(), error_1 = require_error$1(), tstinfo_1 = require_tstinfo();
	exports.RFC3161Timestamp = class RFC3161Timestamp {
		root;
		constructor(asn1) {
			this.root = asn1;
		}
		static parse(der) {
			let asn1 = asn1_1.ASN1Obj.parseBuffer(der);
			return new RFC3161Timestamp(asn1);
		}
		get status() {
			return this.pkiStatusInfoObj.subs[0].toInteger();
		}
		get contentType() {
			return this.contentTypeObj.toOID();
		}
		get eContentType() {
			return this.eContentTypeObj.toOID();
		}
		get signingTime() {
			return this.tstInfo.genTime;
		}
		get signerIssuer() {
			return this.signerSidObj.subs[0].value;
		}
		get signerSerialNumber() {
			return this.signerSidObj.subs[1].value;
		}
		get signerDigestAlgorithm() {
			let oid = this.signerDigestAlgorithmObj.subs[0].toOID();
			return oid_1.SHA2_HASH_ALGOS[oid];
		}
		get signatureAlgorithm() {
			let oid = this.signatureAlgorithmObj.subs[0].toOID();
			return oid_1.ECDSA_SIGNATURE_ALGOS[oid];
		}
		get signatureValue() {
			return this.signatureValueObj.value;
		}
		get tstInfo() {
			return new tstinfo_1.TSTInfo(this.eContentObj.subs[0].subs[0]);
		}
		verify(data, publicKey) {
			if (!this.timeStampTokenObj) throw new error_1.RFC3161TimestampVerificationError("timeStampToken is missing");
			if (this.contentType !== "1.2.840.113549.1.7.2") throw new error_1.RFC3161TimestampVerificationError(`incorrect content type: ${this.contentType}`);
			if (this.eContentType !== "1.2.840.113549.1.9.16.1.4") throw new error_1.RFC3161TimestampVerificationError(`incorrect encapsulated content type: ${this.eContentType}`);
			this.tstInfo.verify(data), this.verifyMessageDigest(), this.verifySignature(publicKey);
		}
		verifyMessageDigest() {
			let tstInfoDigest = crypto.digest(this.signerDigestAlgorithm, this.tstInfo.raw), expectedDigest = this.messageDigestAttributeObj.subs[1].subs[0].value;
			if (!crypto.bufferEqual(tstInfoDigest, expectedDigest)) throw new error_1.RFC3161TimestampVerificationError("signed data does not match tstInfo");
		}
		verifySignature(key) {
			let signedAttrs = this.signedAttrsObj.toDER();
			if (signedAttrs[0] = 49, !crypto.verify(signedAttrs, key, this.signatureValue, this.signatureAlgorithm)) throw new error_1.RFC3161TimestampVerificationError("signature verification failed");
		}
		get pkiStatusInfoObj() {
			return this.root.subs[0];
		}
		get timeStampTokenObj() {
			return this.root.subs[1];
		}
		get contentTypeObj() {
			return this.timeStampTokenObj.subs[0];
		}
		get signedDataObj() {
			return this.timeStampTokenObj.subs.find((sub) => sub.tag.isContextSpecific(0)).subs[0];
		}
		get encapContentInfoObj() {
			return this.signedDataObj.subs[2];
		}
		get signerInfosObj() {
			let sd = this.signedDataObj;
			return sd.subs[sd.subs.length - 1];
		}
		get signerInfoObj() {
			return this.signerInfosObj.subs[0];
		}
		get eContentTypeObj() {
			return this.encapContentInfoObj.subs[0];
		}
		get eContentObj() {
			return this.encapContentInfoObj.subs[1];
		}
		get signedAttrsObj() {
			return this.signerInfoObj.subs.find((sub) => sub.tag.isContextSpecific(0));
		}
		get messageDigestAttributeObj() {
			return this.signedAttrsObj.subs.find((sub) => sub.subs[0].tag.isOID() && sub.subs[0].toOID() === "1.2.840.113549.1.9.4");
		}
		get signerSidObj() {
			return this.signerInfoObj.subs[1];
		}
		get signerDigestAlgorithmObj() {
			return this.signerInfoObj.subs[2];
		}
		get signatureAlgorithmObj() {
			return this.signerInfoObj.subs[4];
		}
		get signatureValueObj() {
			return this.signerInfoObj.subs[5];
		}
	};
})), require_rfc3161 = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.RFC3161Timestamp = void 0;
	var timestamp_1 = require_timestamp$1();
	Object.defineProperty(exports, "RFC3161Timestamp", {
		enumerable: !0,
		get: function() {
			return timestamp_1.RFC3161Timestamp;
		}
	});
})), require_sct$1 = __commonJSMin(((exports) => {
	var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k);
		var desc = Object.getOwnPropertyDescriptor(m, k);
		(!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) && (desc = {
			enumerable: !0,
			get: function() {
				return m[k];
			}
		}), Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k), o[k2] = m[k];
	})), __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
		Object.defineProperty(o, "default", {
			enumerable: !0,
			value: v
		});
	}) : function(o, v) {
		o.default = v;
	}), __importStar = exports && exports.__importStar || (function() {
		var ownKeys = function(o) {
			return ownKeys = Object.getOwnPropertyNames || function(o) {
				var ar = [];
				for (var k in o) Object.prototype.hasOwnProperty.call(o, k) && (ar[ar.length] = k);
				return ar;
			}, ownKeys(o);
		};
		return function(mod) {
			if (mod && mod.__esModule) return mod;
			var result = {};
			if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) k[i] !== "default" && __createBinding(result, mod, k[i]);
			return __setModuleDefault(result, mod), result;
		};
	})();
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.SignedCertificateTimestamp = void 0;
	let crypto = __importStar(require_crypto()), stream_1 = require_stream();
	exports.SignedCertificateTimestamp = class SignedCertificateTimestamp {
		version;
		logID;
		timestamp;
		extensions;
		hashAlgorithm;
		signatureAlgorithm;
		signature;
		constructor(options) {
			this.version = options.version, this.logID = options.logID, this.timestamp = options.timestamp, this.extensions = options.extensions, this.hashAlgorithm = options.hashAlgorithm, this.signatureAlgorithm = options.signatureAlgorithm, this.signature = options.signature;
		}
		get datetime() {
			return new Date(Number(this.timestamp.readBigInt64BE()));
		}
		get algorithm() {
			switch (this.hashAlgorithm) {
				case 0: return "none";
				case 1: return "md5";
				case 2: return "sha1";
				case 3: return "sha224";
				case 4: return "sha256";
				case 5: return "sha384";
				case 6: return "sha512";
				default: return "unknown";
			}
		}
		verify(preCert, key) {
			let stream = new stream_1.ByteStream();
			return stream.appendChar(this.version), stream.appendChar(0), stream.appendView(this.timestamp), stream.appendUint16(1), stream.appendView(preCert), stream.appendUint16(this.extensions.byteLength), this.extensions.byteLength > 0 && stream.appendView(this.extensions), crypto.verify(stream.buffer, key, this.signature, this.algorithm);
		}
		static parse(buf) {
			let stream = new stream_1.ByteStream(buf), version = stream.getUint8(), logID = stream.getBlock(32), timestamp = stream.getBlock(8), extenstionLength = stream.getUint16(), extensions = stream.getBlock(extenstionLength), hashAlgorithm = stream.getUint8(), signatureAlgorithm = stream.getUint8(), sigLength = stream.getUint16(), signature = stream.getBlock(sigLength);
			if (stream.position !== buf.length) throw Error("SCT buffer length mismatch");
			return new SignedCertificateTimestamp({
				version,
				logID,
				timestamp,
				extensions,
				hashAlgorithm,
				signatureAlgorithm,
				signature
			});
		}
	};
})), require_ext = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.X509SCTExtension = exports.X509SubjectKeyIDExtension = exports.X509AuthorityKeyIDExtension = exports.X509SubjectAlternativeNameExtension = exports.X509KeyUsageExtension = exports.X509BasicConstraintsExtension = exports.X509Extension = void 0;
	let stream_1 = require_stream(), sct_1 = require_sct$1();
	var X509Extension = class {
		root;
		constructor(asn1) {
			this.root = asn1;
		}
		get oid() {
			return this.root.subs[0].toOID();
		}
		get critical() {
			return this.root.subs.length === 3 && this.root.subs[1].toBoolean();
		}
		get value() {
			return this.extnValueObj.value;
		}
		get valueObj() {
			return this.extnValueObj;
		}
		get extnValueObj() {
			return this.root.subs[this.root.subs.length - 1];
		}
	};
	exports.X509Extension = X509Extension, exports.X509BasicConstraintsExtension = class extends X509Extension {
		get isCA() {
			return this.sequence.subs[0]?.toBoolean() ?? !1;
		}
		get pathLenConstraint() {
			return this.sequence.subs.length > 1 ? this.sequence.subs[1].toInteger() : void 0;
		}
		get sequence() {
			return this.extnValueObj.subs[0];
		}
	}, exports.X509KeyUsageExtension = class extends X509Extension {
		get digitalSignature() {
			return this.bitString[0] === 1;
		}
		get keyCertSign() {
			return this.bitString[5] === 1;
		}
		get crlSign() {
			return this.bitString[6] === 1;
		}
		get bitString() {
			return this.extnValueObj.subs[0].toBitString();
		}
	}, exports.X509SubjectAlternativeNameExtension = class extends X509Extension {
		get rfc822Name() {
			return this.findGeneralName(1)?.value.toString("ascii");
		}
		get uri() {
			return this.findGeneralName(6)?.value.toString("ascii");
		}
		otherName(oid) {
			let otherName = this.findGeneralName(0);
			if (otherName !== void 0 && otherName.subs[0].toOID() === oid) return otherName.subs[1].subs[0].value.toString("ascii");
		}
		findGeneralName(tag) {
			return this.generalNames.find((gn) => gn.tag.isContextSpecific(tag));
		}
		get generalNames() {
			return this.extnValueObj.subs[0].subs;
		}
	}, exports.X509AuthorityKeyIDExtension = class extends X509Extension {
		get keyIdentifier() {
			return this.findSequenceMember(0)?.value;
		}
		findSequenceMember(tag) {
			return this.sequence.subs.find((el) => el.tag.isContextSpecific(tag));
		}
		get sequence() {
			return this.extnValueObj.subs[0];
		}
	}, exports.X509SubjectKeyIDExtension = class extends X509Extension {
		get keyIdentifier() {
			return this.extnValueObj.subs[0].value;
		}
	}, exports.X509SCTExtension = class extends X509Extension {
		constructor(asn1) {
			super(asn1);
		}
		get signedCertificateTimestamps() {
			let buf = this.extnValueObj.subs[0].value, stream = new stream_1.ByteStream(buf), end = stream.getUint16() + 2, sctList = [];
			for (; stream.position < end;) {
				let sctLength = stream.getUint16(), sct = stream.getBlock(sctLength);
				sctList.push(sct_1.SignedCertificateTimestamp.parse(sct));
			}
			if (stream.position !== end) throw Error("SCT list length does not match actual length");
			return sctList;
		}
	};
})), require_cert = __commonJSMin(((exports) => {
	var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k);
		var desc = Object.getOwnPropertyDescriptor(m, k);
		(!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) && (desc = {
			enumerable: !0,
			get: function() {
				return m[k];
			}
		}), Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k), o[k2] = m[k];
	})), __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
		Object.defineProperty(o, "default", {
			enumerable: !0,
			value: v
		});
	}) : function(o, v) {
		o.default = v;
	}), __importStar = exports && exports.__importStar || (function() {
		var ownKeys = function(o) {
			return ownKeys = Object.getOwnPropertyNames || function(o) {
				var ar = [];
				for (var k in o) Object.prototype.hasOwnProperty.call(o, k) && (ar[ar.length] = k);
				return ar;
			}, ownKeys(o);
		};
		return function(mod) {
			if (mod && mod.__esModule) return mod;
			var result = {};
			if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) k[i] !== "default" && __createBinding(result, mod, k[i]);
			return __setModuleDefault(result, mod), result;
		};
	})();
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.X509Certificate = exports.EXTENSION_OID_SCT = void 0;
	let asn1_1 = require_asn1(), crypto = __importStar(require_crypto()), oid_1 = require_oid(), pem = __importStar(require_pem()), ext_1 = require_ext();
	exports.EXTENSION_OID_SCT = "1.3.6.1.4.1.11129.2.4.2", exports.X509Certificate = class X509Certificate {
		root;
		constructor(asn1) {
			this.root = asn1;
		}
		static parse(cert) {
			let der = typeof cert == "string" ? pem.toDER(cert) : cert, asn1 = asn1_1.ASN1Obj.parseBuffer(der);
			return new X509Certificate(asn1);
		}
		get tbsCertificate() {
			return this.tbsCertificateObj;
		}
		get version() {
			return `v${(this.versionObj.subs[0].toInteger() + BigInt(1)).toString()}`;
		}
		get serialNumber() {
			return this.serialNumberObj.value;
		}
		get notBefore() {
			return this.validityObj.subs[0].toDate();
		}
		get notAfter() {
			return this.validityObj.subs[1].toDate();
		}
		get issuer() {
			return this.issuerObj.value;
		}
		get subject() {
			return this.subjectObj.value;
		}
		get publicKey() {
			return this.subjectPublicKeyInfoObj.toDER();
		}
		get signatureAlgorithm() {
			let oid = this.signatureAlgorithmObj.subs[0].toOID();
			return oid_1.RSA_SIGNATURE_ALGOS[oid] ? oid_1.RSA_SIGNATURE_ALGOS[oid] : oid_1.ECDSA_SIGNATURE_ALGOS[oid];
		}
		get signatureValue() {
			return this.signatureValueObj.value.subarray(1);
		}
		get subjectAltName() {
			let ext = this.extSubjectAltName;
			return ext?.uri || ext?.rfc822Name;
		}
		get extensions() {
			return this.extensionsObj?.subs[0]?.subs || [];
		}
		get extKeyUsage() {
			let ext = this.findExtension("2.5.29.15");
			return ext ? new ext_1.X509KeyUsageExtension(ext) : void 0;
		}
		get extBasicConstraints() {
			let ext = this.findExtension("2.5.29.19");
			return ext ? new ext_1.X509BasicConstraintsExtension(ext) : void 0;
		}
		get extSubjectAltName() {
			let ext = this.findExtension("2.5.29.17");
			return ext ? new ext_1.X509SubjectAlternativeNameExtension(ext) : void 0;
		}
		get extAuthorityKeyID() {
			let ext = this.findExtension("2.5.29.35");
			return ext ? new ext_1.X509AuthorityKeyIDExtension(ext) : void 0;
		}
		get extSubjectKeyID() {
			let ext = this.findExtension("2.5.29.14");
			return ext ? new ext_1.X509SubjectKeyIDExtension(ext) : void 0;
		}
		get extSCT() {
			let ext = this.findExtension(exports.EXTENSION_OID_SCT);
			return ext ? new ext_1.X509SCTExtension(ext) : void 0;
		}
		get isCA() {
			let ca = this.extBasicConstraints?.isCA || !1;
			return this.extKeyUsage ? ca && this.extKeyUsage.keyCertSign : ca;
		}
		extension(oid) {
			let ext = this.findExtension(oid);
			return ext ? new ext_1.X509Extension(ext) : void 0;
		}
		verify(issuerCertificate) {
			let publicKey = issuerCertificate?.publicKey || this.publicKey, key = crypto.createPublicKey(publicKey);
			return crypto.verify(this.tbsCertificate.toDER(), key, this.signatureValue, this.signatureAlgorithm);
		}
		validForDate(date) {
			return this.notBefore <= date && date <= this.notAfter;
		}
		equals(other) {
			return this.root.toDER().equals(other.root.toDER());
		}
		clone() {
			let der = this.root.toDER(), clone = Buffer.alloc(der.length);
			return der.copy(clone), X509Certificate.parse(clone);
		}
		findExtension(oid) {
			return this.extensions.find((ext) => ext.subs[0].toOID() === oid);
		}
		get tbsCertificateObj() {
			return this.root.subs[0];
		}
		get signatureAlgorithmObj() {
			return this.root.subs[1];
		}
		get signatureValueObj() {
			return this.root.subs[2];
		}
		get versionObj() {
			return this.tbsCertificateObj.subs[0];
		}
		get serialNumberObj() {
			return this.tbsCertificateObj.subs[1];
		}
		get issuerObj() {
			return this.tbsCertificateObj.subs[3];
		}
		get validityObj() {
			return this.tbsCertificateObj.subs[4];
		}
		get subjectObj() {
			return this.tbsCertificateObj.subs[5];
		}
		get subjectPublicKeyInfoObj() {
			return this.tbsCertificateObj.subs[6];
		}
		get extensionsObj() {
			return this.tbsCertificateObj.subs.find((sub) => sub.tag.isContextSpecific(3));
		}
	};
})), require_x509 = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.X509SCTExtension = exports.X509Certificate = exports.EXTENSION_OID_SCT = void 0;
	var cert_1 = require_cert();
	Object.defineProperty(exports, "EXTENSION_OID_SCT", {
		enumerable: !0,
		get: function() {
			return cert_1.EXTENSION_OID_SCT;
		}
	}), Object.defineProperty(exports, "X509Certificate", {
		enumerable: !0,
		get: function() {
			return cert_1.X509Certificate;
		}
	});
	var ext_1 = require_ext();
	Object.defineProperty(exports, "X509SCTExtension", {
		enumerable: !0,
		get: function() {
			return ext_1.X509SCTExtension;
		}
	});
})), require_dist$1 = __commonJSMin(((exports) => {
	var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k);
		var desc = Object.getOwnPropertyDescriptor(m, k);
		(!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) && (desc = {
			enumerable: !0,
			get: function() {
				return m[k];
			}
		}), Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k), o[k2] = m[k];
	})), __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
		Object.defineProperty(o, "default", {
			enumerable: !0,
			value: v
		});
	}) : function(o, v) {
		o.default = v;
	}), __importStar = exports && exports.__importStar || (function() {
		var ownKeys = function(o) {
			return ownKeys = Object.getOwnPropertyNames || function(o) {
				var ar = [];
				for (var k in o) Object.prototype.hasOwnProperty.call(o, k) && (ar[ar.length] = k);
				return ar;
			}, ownKeys(o);
		};
		return function(mod) {
			if (mod && mod.__esModule) return mod;
			var result = {};
			if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) k[i] !== "default" && __createBinding(result, mod, k[i]);
			return __setModuleDefault(result, mod), result;
		};
	})();
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.X509SCTExtension = exports.X509Certificate = exports.EXTENSION_OID_SCT = exports.ByteStream = exports.RFC3161Timestamp = exports.pem = exports.json = exports.encoding = exports.dsse = exports.crypto = exports.ASN1Obj = void 0;
	var asn1_1 = require_asn1();
	Object.defineProperty(exports, "ASN1Obj", {
		enumerable: !0,
		get: function() {
			return asn1_1.ASN1Obj;
		}
	}), exports.crypto = __importStar(require_crypto()), exports.dsse = __importStar(require_dsse$3()), exports.encoding = __importStar(require_encoding()), exports.json = __importStar(require_json()), exports.pem = __importStar(require_pem());
	var rfc3161_1 = require_rfc3161();
	Object.defineProperty(exports, "RFC3161Timestamp", {
		enumerable: !0,
		get: function() {
			return rfc3161_1.RFC3161Timestamp;
		}
	});
	var stream_1 = require_stream();
	Object.defineProperty(exports, "ByteStream", {
		enumerable: !0,
		get: function() {
			return stream_1.ByteStream;
		}
	});
	var x509_1 = require_x509();
	Object.defineProperty(exports, "EXTENSION_OID_SCT", {
		enumerable: !0,
		get: function() {
			return x509_1.EXTENSION_OID_SCT;
		}
	}), Object.defineProperty(exports, "X509Certificate", {
		enumerable: !0,
		get: function() {
			return x509_1.X509Certificate;
		}
	}), Object.defineProperty(exports, "X509SCTExtension", {
		enumerable: !0,
		get: function() {
			return x509_1.X509SCTExtension;
		}
	});
})), require_dsse$2 = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.DSSESignatureContent = void 0;
	let core_1 = require_dist$1();
	exports.DSSESignatureContent = class {
		env;
		constructor(env) {
			this.env = env;
		}
		compareDigest(digest) {
			return core_1.crypto.bufferEqual(digest, core_1.crypto.digest("sha256", this.env.payload));
		}
		compareSignedDigest(digest) {
			return core_1.crypto.bufferEqual(digest, core_1.crypto.digest("sha256", this.preAuthEncoding));
		}
		compareSignature(signature) {
			return core_1.crypto.bufferEqual(signature, this.signature);
		}
		verifySignature(key) {
			return core_1.crypto.verify(this.preAuthEncoding, key, this.signature);
		}
		get signature() {
			return this.env.signatures.length > 0 ? this.env.signatures[0].sig : Buffer.from("");
		}
		get preAuthEncoding() {
			return core_1.dsse.preAuthEncoding(this.env.payloadType, this.env.payload);
		}
	};
})), require_message = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.MessageSignatureContent = void 0;
	let core_1 = require_dist$1(), protobuf_specs_1 = require_dist$6(), HASH_ALGORITHM_MAP = {
		[protobuf_specs_1.HashAlgorithm.HASH_ALGORITHM_UNSPECIFIED]: "sha256",
		[protobuf_specs_1.HashAlgorithm.SHA2_256]: "sha256",
		[protobuf_specs_1.HashAlgorithm.SHA2_384]: "sha384",
		[protobuf_specs_1.HashAlgorithm.SHA2_512]: "sha512",
		[protobuf_specs_1.HashAlgorithm.SHA3_256]: "sha3-256",
		[protobuf_specs_1.HashAlgorithm.SHA3_384]: "sha3-384"
	};
	exports.MessageSignatureContent = class {
		signature;
		messageDigest;
		artifact;
		hashAlgorithm;
		constructor(messageSignature, artifact) {
			this.signature = messageSignature.signature, this.messageDigest = messageSignature.messageDigest.digest, this.artifact = artifact, this.hashAlgorithm = HASH_ALGORITHM_MAP[messageSignature.messageDigest.algorithm] ?? "sha256";
		}
		compareSignature(signature) {
			return core_1.crypto.bufferEqual(signature, this.signature);
		}
		compareDigest(digest) {
			return core_1.crypto.bufferEqual(digest, this.messageDigest);
		}
		compareSignedDigest(digest) {
			return this.compareDigest(digest);
		}
		verifySignature(key) {
			return core_1.crypto.verify(this.artifact, key, this.signature, this.hashAlgorithm);
		}
	};
})), require_bundle = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.toSignedEntity = toSignedEntity, exports.signatureContent = signatureContent;
	let core_1 = require_dist$1(), dsse_1 = require_dsse$2(), message_1 = require_message();
	function toSignedEntity(bundle, artifact) {
		let { tlogEntries, timestampVerificationData } = bundle.verificationMaterial, timestamps = [];
		for (let entry of tlogEntries) entry.integratedTime && entry.integratedTime !== "0" && timestamps.push({
			$case: "transparency-log",
			tlogEntry: entry
		});
		for (let ts of timestampVerificationData?.rfc3161Timestamps ?? []) timestamps.push({
			$case: "timestamp-authority",
			timestamp: core_1.RFC3161Timestamp.parse(Buffer.from(ts.signedTimestamp))
		});
		return {
			signature: signatureContent(bundle, artifact),
			key: key(bundle),
			tlogEntries,
			timestamps
		};
	}
	function signatureContent(bundle, artifact) {
		switch (bundle.content.$case) {
			case "dsseEnvelope": return new dsse_1.DSSESignatureContent(bundle.content.dsseEnvelope);
			case "messageSignature": return new message_1.MessageSignatureContent(bundle.content.messageSignature, artifact);
		}
	}
	function key(bundle) {
		switch (bundle.verificationMaterial.content.$case) {
			case "publicKey": return {
				$case: "public-key",
				hint: bundle.verificationMaterial.content.publicKey.hint
			};
			case "x509CertificateChain": return {
				$case: "certificate",
				certificate: core_1.X509Certificate.parse(Buffer.from(bundle.verificationMaterial.content.x509CertificateChain.certificates[0].rawBytes))
			};
			case "certificate": return {
				$case: "certificate",
				certificate: core_1.X509Certificate.parse(Buffer.from(bundle.verificationMaterial.content.certificate.rawBytes))
			};
		}
	}
})), require_error = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.PolicyError = exports.VerificationError = void 0;
	var BaseError = class extends Error {
		code;
		cause;
		constructor({ code, message, cause }) {
			super(message), this.code = code, this.cause = cause, this.name = this.constructor.name;
		}
	};
	exports.VerificationError = class extends BaseError {}, exports.PolicyError = class extends BaseError {};
})), require_filter = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.filterCertAuthorities = filterCertAuthorities, exports.filterTLogAuthorities = filterTLogAuthorities;
	function filterCertAuthorities(certAuthorities, timestamp) {
		return certAuthorities.filter((ca) => ca.validFor.start <= timestamp && ca.validFor.end >= timestamp);
	}
	function filterTLogAuthorities(tlogAuthorities, criteria) {
		return tlogAuthorities.filter((tlog) => criteria.logID && !tlog.logID.equals(criteria.logID) ? !1 : tlog.validFor.start <= criteria.targetDate && criteria.targetDate <= tlog.validFor.end);
	}
})), require_trust = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.filterTLogAuthorities = exports.filterCertAuthorities = void 0, exports.toTrustMaterial = toTrustMaterial;
	let core_1 = require_dist$1(), protobuf_specs_1 = require_dist$6(), error_1 = require_error(), BEGINNING_OF_TIME = new Date(0), END_OF_TIME = new Date(864e13);
	var filter_1 = require_filter();
	Object.defineProperty(exports, "filterCertAuthorities", {
		enumerable: !0,
		get: function() {
			return filter_1.filterCertAuthorities;
		}
	}), Object.defineProperty(exports, "filterTLogAuthorities", {
		enumerable: !0,
		get: function() {
			return filter_1.filterTLogAuthorities;
		}
	});
	function toTrustMaterial(root, keys) {
		let keyFinder = typeof keys == "function" ? keys : keyLocator(keys);
		return {
			certificateAuthorities: root.certificateAuthorities.map(createCertAuthority),
			timestampAuthorities: root.timestampAuthorities.map(createCertAuthority),
			tlogs: root.tlogs.map(createTLogAuthority),
			ctlogs: root.ctlogs.map(createTLogAuthority),
			publicKey: keyFinder
		};
	}
	function createTLogAuthority(tlogInstance) {
		let keyDetails = tlogInstance.publicKey.keyDetails, keyType = keyDetails === protobuf_specs_1.PublicKeyDetails.PKCS1_RSA_PKCS1V5 || keyDetails === protobuf_specs_1.PublicKeyDetails.PKIX_RSA_PKCS1V5 || keyDetails === protobuf_specs_1.PublicKeyDetails.PKIX_RSA_PKCS1V15_2048_SHA256 || keyDetails === protobuf_specs_1.PublicKeyDetails.PKIX_RSA_PKCS1V15_3072_SHA256 || keyDetails === protobuf_specs_1.PublicKeyDetails.PKIX_RSA_PKCS1V15_4096_SHA256 ? "pkcs1" : "spki";
		return {
			baseURL: tlogInstance.baseUrl,
			logID: tlogInstance.checkpointKeyId ? tlogInstance.checkpointKeyId.keyId : tlogInstance.logId.keyId,
			publicKey: core_1.crypto.createPublicKey(tlogInstance.publicKey.rawBytes, keyType),
			validFor: {
				start: tlogInstance.publicKey.validFor?.start || BEGINNING_OF_TIME,
				end: tlogInstance.publicKey.validFor?.end || END_OF_TIME
			}
		};
	}
	function createCertAuthority(ca) {
		return {
			certChain: ca.certChain.certificates.map((cert) => core_1.X509Certificate.parse(Buffer.from(cert.rawBytes))),
			validFor: {
				start: ca.validFor?.start || BEGINNING_OF_TIME,
				end: ca.validFor?.end || END_OF_TIME
			}
		};
	}
	function keyLocator(keys) {
		return (hint) => {
			let key = (keys || {})[hint];
			if (!key) throw new error_1.VerificationError({
				code: "PUBLIC_KEY_ERROR",
				message: `key not found: ${hint}`
			});
			return {
				publicKey: core_1.crypto.createPublicKey(key.rawBytes),
				validFor: (date) => (key.validFor?.start || BEGINNING_OF_TIME) <= date && (key.validFor?.end || END_OF_TIME) >= date
			};
		};
	}
})), require_certificate = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.CertificateChainVerifier = void 0, exports.verifyCertificateChain = verifyCertificateChain;
	let error_1 = require_error(), trust_1 = require_trust();
	function verifyCertificateChain(timestamp, leaf, certificateAuthorities) {
		let cas = (0, trust_1.filterCertAuthorities)(certificateAuthorities, timestamp), error;
		for (let ca of cas) try {
			return new CertificateChainVerifier({
				trustedCerts: ca.certChain,
				untrustedCert: leaf,
				timestamp
			}).verify();
		} catch (err) {
			error = err;
		}
		throw new error_1.VerificationError({
			code: "CERTIFICATE_ERROR",
			message: "Failed to verify certificate chain",
			cause: error
		});
	}
	var CertificateChainVerifier = class {
		untrustedCert;
		trustedCerts;
		localCerts;
		timestamp;
		constructor(opts) {
			this.untrustedCert = opts.untrustedCert, this.trustedCerts = opts.trustedCerts, this.localCerts = dedupeCertificates([...opts.trustedCerts, opts.untrustedCert]), this.timestamp = opts.timestamp;
		}
		verify() {
			let certificatePath = this.sort();
			if (this.checkPath(certificatePath), !certificatePath.every((cert) => cert.validForDate(this.timestamp))) throw new error_1.VerificationError({
				code: "CERTIFICATE_ERROR",
				message: "certificate is not valid or expired at the specified date"
			});
			return certificatePath;
		}
		sort() {
			let leafCert = this.untrustedCert, paths = this.buildPaths(leafCert);
			if (paths = paths.filter((path) => path.some((cert) => this.trustedCerts.includes(cert))), paths.length === 0) throw new error_1.VerificationError({
				code: "CERTIFICATE_ERROR",
				message: "no trusted certificate path found"
			});
			return [leafCert, ...paths.reduce((prev, curr) => prev.length < curr.length ? prev : curr)].slice(0, -1);
		}
		buildPaths(certificate) {
			let paths = [], issuers = this.findIssuer(certificate);
			if (issuers.length === 0) throw new error_1.VerificationError({
				code: "CERTIFICATE_ERROR",
				message: "no valid certificate path found"
			});
			for (let i = 0; i < issuers.length; i++) {
				let issuer = issuers[i];
				if (issuer.equals(certificate)) {
					paths.push([certificate]);
					continue;
				}
				let subPaths = this.buildPaths(issuer);
				for (let j = 0; j < subPaths.length; j++) paths.push([issuer, ...subPaths[j]]);
			}
			return paths;
		}
		findIssuer(certificate) {
			let issuers = [], keyIdentifier;
			return certificate.subject.equals(certificate.issuer) && certificate.verify() ? [certificate] : (certificate.extAuthorityKeyID && (keyIdentifier = certificate.extAuthorityKeyID.keyIdentifier), this.localCerts.forEach((possibleIssuer) => {
				if (keyIdentifier && possibleIssuer.extSubjectKeyID) {
					possibleIssuer.extSubjectKeyID.keyIdentifier.equals(keyIdentifier) && issuers.push(possibleIssuer);
					return;
				}
				possibleIssuer.subject.equals(certificate.issuer) && issuers.push(possibleIssuer);
			}), issuers = issuers.filter((issuer) => {
				try {
					return certificate.verify(issuer);
				} catch {
					return !1;
				}
			}), issuers);
		}
		checkPath(path) {
			if (path.length < 1) throw new error_1.VerificationError({
				code: "CERTIFICATE_ERROR",
				message: "certificate chain must contain at least one certificate"
			});
			if (!path.slice(1).every((cert) => cert.isCA)) throw new error_1.VerificationError({
				code: "CERTIFICATE_ERROR",
				message: "intermediate certificate is not a CA"
			});
			for (let i = path.length - 2; i >= 0; i--) if (!path[i].issuer.equals(path[i + 1].subject)) throw new error_1.VerificationError({
				code: "CERTIFICATE_ERROR",
				message: "incorrect certificate name chaining"
			});
			for (let i = 0; i < path.length; i++) {
				let cert = path[i];
				if (cert.extBasicConstraints?.isCA) {
					let pathLength = cert.extBasicConstraints.pathLenConstraint;
					if (pathLength !== void 0 && pathLength < i - 1) throw new error_1.VerificationError({
						code: "CERTIFICATE_ERROR",
						message: "path length constraint exceeded"
					});
				}
			}
		}
	};
	exports.CertificateChainVerifier = CertificateChainVerifier;
	function dedupeCertificates(certs) {
		for (let i = 0; i < certs.length; i++) for (let j = i + 1; j < certs.length; j++) certs[i].equals(certs[j]) && (certs.splice(j, 1), j--);
		return certs;
	}
})), require_sct = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.verifySCTs = verifySCTs;
	let core_1 = require_dist$1(), error_1 = require_error(), trust_1 = require_trust();
	function verifySCTs(cert, issuer, ctlogs) {
		let extSCT, clone = cert.clone();
		for (let i = 0; i < clone.extensions.length; i++) {
			let ext = clone.extensions[i];
			if (ext.subs[0].toOID() === core_1.EXTENSION_OID_SCT) {
				extSCT = new core_1.X509SCTExtension(ext), clone.extensions.splice(i, 1);
				break;
			}
		}
		if (!extSCT || extSCT.signedCertificateTimestamps.length === 0) return [];
		let preCert = new core_1.ByteStream(), issuerId = core_1.crypto.digest("sha256", issuer.publicKey);
		preCert.appendView(issuerId);
		let tbs = clone.tbsCertificate.toDER();
		return preCert.appendUint24(tbs.length), preCert.appendView(tbs), extSCT.signedCertificateTimestamps.map((sct) => {
			if (!(0, trust_1.filterTLogAuthorities)(ctlogs, {
				logID: sct.logID,
				targetDate: sct.datetime
			}).some((log) => sct.verify(preCert.buffer, log.publicKey))) throw new error_1.VerificationError({
				code: "CERTIFICATE_ERROR",
				message: "SCT verification failed"
			});
			return sct.logID;
		});
	}
})), require_key = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.verifyPublicKey = verifyPublicKey, exports.verifyCertificate = verifyCertificate;
	let core_1 = require_dist$1(), error_1 = require_error(), certificate_1 = require_certificate(), sct_1 = require_sct();
	function verifyPublicKey(hint, timestamps, trustMaterial) {
		let key = trustMaterial.publicKey(hint);
		return timestamps.forEach((timestamp) => {
			if (!key.validFor(timestamp)) throw new error_1.VerificationError({
				code: "PUBLIC_KEY_ERROR",
				message: `Public key is not valid for timestamp: ${timestamp.toISOString()}`
			});
		}), { key: key.publicKey };
	}
	function verifyCertificate(leaf, timestamps, trustMaterial) {
		let path = [];
		return timestamps.forEach((timestamp) => {
			path = (0, certificate_1.verifyCertificateChain)(timestamp, leaf, trustMaterial.certificateAuthorities);
		}), {
			scts: (0, sct_1.verifySCTs)(path[0], path[1], trustMaterial.ctlogs),
			signer: getSigner(path[0])
		};
	}
	function getSigner(cert) {
		let issuer, issuerExtension = cert.extension("1.3.6.1.4.1.57264.1.8");
		issuer = issuerExtension ? issuerExtension.valueObj.subs?.[0]?.value.toString("ascii") : cert.extension("1.3.6.1.4.1.57264.1.1")?.value.toString("ascii");
		let oids = cert.extensions.map((ext) => ({
			oid: { id: ext.subs[0].toOID().split(".").map(Number) },
			value: ext.subs[ext.subs.length - 1].value
		})), identity = {
			extensions: { issuer },
			subjectAlternativeName: cert.subjectAltName,
			oids
		};
		return {
			key: core_1.crypto.createPublicKey(cert.publicKey),
			identity
		};
	}
})), require_policy = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.verifySubjectAlternativeName = verifySubjectAlternativeName, exports.verifyExtensions = verifyExtensions, exports.verifyOIDs = verifyOIDs;
	let error_1 = require_error();
	function verifySubjectAlternativeName(policyIdentity, signerIdentity) {
		if (signerIdentity === void 0 || !signerIdentity.match(policyIdentity)) throw new error_1.PolicyError({
			code: "UNTRUSTED_SIGNER_ERROR",
			message: `certificate identity error - expected ${policyIdentity}, got ${signerIdentity}`
		});
	}
	function verifyExtensions(policyExtensions, signerExtensions = {}) {
		let key;
		for (key in policyExtensions) if (signerExtensions[key] !== policyExtensions[key]) throw new error_1.PolicyError({
			code: "UNTRUSTED_SIGNER_ERROR",
			message: `invalid certificate extension - expected ${key}=${policyExtensions[key]}, got ${key}=${signerExtensions[key]}`
		});
	}
	function verifyOIDs(policyOIDs, signerOIDs = []) {
		for (let policyOID of policyOIDs) if (!signerOIDs.find((signerOID) => oidEquals(policyOID.oid?.id, signerOID.oid?.id) && policyOID.value.equals(signerOID.value))) {
			let oid = policyOID.oid?.id.join(".") ?? "<unknown>";
			throw new error_1.PolicyError({
				code: "UNTRUSTED_SIGNER_ERROR",
				message: `invalid certificate extension - missing OID ${oid}`
			});
		}
	}
	function oidEquals(a, b) {
		return a === void 0 || b === void 0 ? !1 : a.length === b.length && a.every((v, i) => v === b[i]);
	}
})), require_tsa = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.verifyRFC3161Timestamp = verifyRFC3161Timestamp;
	let core_1 = require_dist$1(), error_1 = require_error(), certificate_1 = require_certificate(), trust_1 = require_trust();
	function verifyRFC3161Timestamp(timestamp, data, timestampAuthorities) {
		let signingTime = timestamp.signingTime;
		if (timestampAuthorities = (0, trust_1.filterCertAuthorities)(timestampAuthorities, signingTime), timestampAuthorities = filterCAsBySerialAndIssuer(timestampAuthorities, {
			serialNumber: timestamp.signerSerialNumber,
			issuer: timestamp.signerIssuer
		}), !timestampAuthorities.some((ca) => {
			try {
				return verifyTimestampForCA(timestamp, data, ca), !0;
			} catch {
				return !1;
			}
		})) throw new error_1.VerificationError({
			code: "TIMESTAMP_ERROR",
			message: "timestamp could not be verified"
		});
	}
	function verifyTimestampForCA(timestamp, data, ca) {
		let [leaf, ...cas] = ca.certChain, signingKey = core_1.crypto.createPublicKey(leaf.publicKey), signingTime = timestamp.signingTime;
		try {
			new certificate_1.CertificateChainVerifier({
				untrustedCert: leaf,
				trustedCerts: cas,
				timestamp: signingTime
			}).verify();
		} catch {
			throw new error_1.VerificationError({
				code: "TIMESTAMP_ERROR",
				message: "invalid certificate chain"
			});
		}
		timestamp.verify(data, signingKey);
	}
	function filterCAsBySerialAndIssuer(timestampAuthorities, criteria) {
		return timestampAuthorities.filter((ca) => ca.certChain.length > 0 && core_1.crypto.bufferEqual(ca.certChain[0].serialNumber, criteria.serialNumber) && core_1.crypto.bufferEqual(ca.certChain[0].issuer, criteria.issuer));
	}
})), require_timestamp = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.getTSATimestamp = getTSATimestamp, exports.getTLogTimestamp = getTLogTimestamp;
	let tsa_1 = require_tsa();
	function getTSATimestamp(timestamp, data, timestampAuthorities) {
		return (0, tsa_1.verifyRFC3161Timestamp)(timestamp, data, timestampAuthorities), {
			type: "timestamp-authority",
			logID: timestamp.signerSerialNumber,
			timestamp: timestamp.signingTime
		};
	}
	function getTLogTimestamp(entry) {
		if (entry.inclusionPromise) return {
			type: "transparency-log",
			logID: entry.logId.keyId,
			timestamp: new Date(Number(entry.integratedTime) * 1e3)
		};
	}
})), require_verifier$1 = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Signature = exports.Verifier = exports.PublicKey = void 0;
	let sigstore_common_1 = require_sigstore_common();
	exports.PublicKey = {
		fromJSON(object) {
			return { rawBytes: isSet(object.rawBytes) ? Buffer.from(bytesFromBase64(object.rawBytes)) : Buffer.alloc(0) };
		},
		toJSON(message) {
			let obj = {};
			return message.rawBytes.length !== 0 && (obj.rawBytes = base64FromBytes(message.rawBytes)), obj;
		}
	}, exports.Verifier = {
		fromJSON(object) {
			return {
				verifier: isSet(object.publicKey) ? {
					$case: "publicKey",
					publicKey: exports.PublicKey.fromJSON(object.publicKey)
				} : isSet(object.x509Certificate) ? {
					$case: "x509Certificate",
					x509Certificate: sigstore_common_1.X509Certificate.fromJSON(object.x509Certificate)
				} : void 0,
				keyDetails: isSet(object.keyDetails) ? (0, sigstore_common_1.publicKeyDetailsFromJSON)(object.keyDetails) : 0
			};
		},
		toJSON(message) {
			let obj = {};
			return message.verifier?.$case === "publicKey" ? obj.publicKey = exports.PublicKey.toJSON(message.verifier.publicKey) : message.verifier?.$case === "x509Certificate" && (obj.x509Certificate = sigstore_common_1.X509Certificate.toJSON(message.verifier.x509Certificate)), message.keyDetails !== 0 && (obj.keyDetails = (0, sigstore_common_1.publicKeyDetailsToJSON)(message.keyDetails)), obj;
		}
	}, exports.Signature = {
		fromJSON(object) {
			return {
				content: isSet(object.content) ? Buffer.from(bytesFromBase64(object.content)) : Buffer.alloc(0),
				verifier: isSet(object.verifier) ? exports.Verifier.fromJSON(object.verifier) : void 0
			};
		},
		toJSON(message) {
			let obj = {};
			return message.content.length !== 0 && (obj.content = base64FromBytes(message.content)), message.verifier !== void 0 && (obj.verifier = exports.Verifier.toJSON(message.verifier)), obj;
		}
	};
	function bytesFromBase64(b64) {
		return Uint8Array.from(globalThis.Buffer.from(b64, "base64"));
	}
	function base64FromBytes(arr) {
		return globalThis.Buffer.from(arr).toString("base64");
	}
	function isSet(value) {
		return value != null;
	}
})), require_dsse$1 = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.DSSELogEntryV002 = exports.DSSERequestV002 = void 0;
	let envelope_1 = require_envelope(), sigstore_common_1 = require_sigstore_common(), verifier_1 = require_verifier$1();
	exports.DSSERequestV002 = {
		fromJSON(object) {
			return {
				envelope: isSet(object.envelope) ? envelope_1.Envelope.fromJSON(object.envelope) : void 0,
				verifiers: globalThis.Array.isArray(object?.verifiers) ? object.verifiers.map((e) => verifier_1.Verifier.fromJSON(e)) : []
			};
		},
		toJSON(message) {
			let obj = {};
			return message.envelope !== void 0 && (obj.envelope = envelope_1.Envelope.toJSON(message.envelope)), message.verifiers?.length && (obj.verifiers = message.verifiers.map((e) => verifier_1.Verifier.toJSON(e))), obj;
		}
	}, exports.DSSELogEntryV002 = {
		fromJSON(object) {
			return {
				payloadHash: isSet(object.payloadHash) ? sigstore_common_1.HashOutput.fromJSON(object.payloadHash) : void 0,
				signatures: globalThis.Array.isArray(object?.signatures) ? object.signatures.map((e) => verifier_1.Signature.fromJSON(e)) : []
			};
		},
		toJSON(message) {
			let obj = {};
			return message.payloadHash !== void 0 && (obj.payloadHash = sigstore_common_1.HashOutput.toJSON(message.payloadHash)), message.signatures?.length && (obj.signatures = message.signatures.map((e) => verifier_1.Signature.toJSON(e))), obj;
		}
	};
	function isSet(value) {
		return value != null;
	}
})), require_hashedrekord$1 = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.HashedRekordLogEntryV002 = exports.HashedRekordRequestV002 = void 0;
	let sigstore_common_1 = require_sigstore_common(), verifier_1 = require_verifier$1();
	exports.HashedRekordRequestV002 = {
		fromJSON(object) {
			return {
				digest: isSet(object.digest) ? Buffer.from(bytesFromBase64(object.digest)) : Buffer.alloc(0),
				signature: isSet(object.signature) ? verifier_1.Signature.fromJSON(object.signature) : void 0
			};
		},
		toJSON(message) {
			let obj = {};
			return message.digest.length !== 0 && (obj.digest = base64FromBytes(message.digest)), message.signature !== void 0 && (obj.signature = verifier_1.Signature.toJSON(message.signature)), obj;
		}
	}, exports.HashedRekordLogEntryV002 = {
		fromJSON(object) {
			return {
				data: isSet(object.data) ? sigstore_common_1.HashOutput.fromJSON(object.data) : void 0,
				signature: isSet(object.signature) ? verifier_1.Signature.fromJSON(object.signature) : void 0
			};
		},
		toJSON(message) {
			let obj = {};
			return message.data !== void 0 && (obj.data = sigstore_common_1.HashOutput.toJSON(message.data)), message.signature !== void 0 && (obj.signature = verifier_1.Signature.toJSON(message.signature)), obj;
		}
	};
	function bytesFromBase64(b64) {
		return Uint8Array.from(globalThis.Buffer.from(b64, "base64"));
	}
	function base64FromBytes(arr) {
		return globalThis.Buffer.from(arr).toString("base64");
	}
	function isSet(value) {
		return value != null;
	}
})), require_entry = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.CreateEntryRequest = exports.Spec = exports.Entry = void 0;
	let dsse_1 = require_dsse$1(), hashedrekord_1 = require_hashedrekord$1();
	exports.Entry = {
		fromJSON(object) {
			return {
				kind: isSet(object.kind) ? globalThis.String(object.kind) : "",
				apiVersion: isSet(object.apiVersion) ? globalThis.String(object.apiVersion) : "",
				spec: isSet(object.spec) ? exports.Spec.fromJSON(object.spec) : void 0
			};
		},
		toJSON(message) {
			let obj = {};
			return message.kind !== "" && (obj.kind = message.kind), message.apiVersion !== "" && (obj.apiVersion = message.apiVersion), message.spec !== void 0 && (obj.spec = exports.Spec.toJSON(message.spec)), obj;
		}
	}, exports.Spec = {
		fromJSON(object) {
			return { spec: isSet(object.hashedRekordV002) ? {
				$case: "hashedRekordV002",
				hashedRekordV002: hashedrekord_1.HashedRekordLogEntryV002.fromJSON(object.hashedRekordV002)
			} : isSet(object.dsseV002) ? {
				$case: "dsseV002",
				dsseV002: dsse_1.DSSELogEntryV002.fromJSON(object.dsseV002)
			} : void 0 };
		},
		toJSON(message) {
			let obj = {};
			return message.spec?.$case === "hashedRekordV002" ? obj.hashedRekordV002 = hashedrekord_1.HashedRekordLogEntryV002.toJSON(message.spec.hashedRekordV002) : message.spec?.$case === "dsseV002" && (obj.dsseV002 = dsse_1.DSSELogEntryV002.toJSON(message.spec.dsseV002)), obj;
		}
	}, exports.CreateEntryRequest = {
		fromJSON(object) {
			return { spec: isSet(object.hashedRekordRequestV002) ? {
				$case: "hashedRekordRequestV002",
				hashedRekordRequestV002: hashedrekord_1.HashedRekordRequestV002.fromJSON(object.hashedRekordRequestV002)
			} : isSet(object.dsseRequestV002) ? {
				$case: "dsseRequestV002",
				dsseRequestV002: dsse_1.DSSERequestV002.fromJSON(object.dsseRequestV002)
			} : void 0 };
		},
		toJSON(message) {
			let obj = {};
			return message.spec?.$case === "hashedRekordRequestV002" ? obj.hashedRekordRequestV002 = hashedrekord_1.HashedRekordRequestV002.toJSON(message.spec.hashedRekordRequestV002) : message.spec?.$case === "dsseRequestV002" && (obj.dsseRequestV002 = dsse_1.DSSERequestV002.toJSON(message.spec.dsseRequestV002)), obj;
		}
	};
	function isSet(value) {
		return value != null;
	}
})), require_v2 = __commonJSMin(((exports) => {
	var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k);
		var desc = Object.getOwnPropertyDescriptor(m, k);
		(!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) && (desc = {
			enumerable: !0,
			get: function() {
				return m[k];
			}
		}), Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k), o[k2] = m[k];
	})), __exportStar = exports && exports.__exportStar || function(m, exports$1) {
		for (var p in m) p !== "default" && !Object.prototype.hasOwnProperty.call(exports$1, p) && __createBinding(exports$1, m, p);
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), __exportStar(require_dsse$1(), exports), __exportStar(require_entry(), exports), __exportStar(require_hashedrekord$1(), exports), __exportStar(require_verifier$1(), exports);
})), require_dsse = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.DSSE_API_VERSION_V1 = void 0, exports.verifyDSSETLogBody = verifyDSSETLogBody, exports.verifyDSSETLogBodyV2 = verifyDSSETLogBodyV2;
	let error_1 = require_error();
	exports.DSSE_API_VERSION_V1 = "0.0.1";
	function verifyDSSETLogBody(tlogEntry, content) {
		switch (tlogEntry.apiVersion) {
			case exports.DSSE_API_VERSION_V1: return verifyDSSE001TLogBody(tlogEntry, content);
			default: throw new error_1.VerificationError({
				code: "TLOG_BODY_ERROR",
				message: `unsupported dsse version: ${tlogEntry.apiVersion}`
			});
		}
	}
	function verifyDSSETLogBodyV2(tlogEntry, content) {
		let spec = tlogEntry.spec?.spec;
		if (!spec) throw new error_1.VerificationError({
			code: "TLOG_BODY_ERROR",
			message: "missing dsse spec"
		});
		switch (spec.$case) {
			case "dsseV002": return verifyDSSE002TLogBody(spec.dsseV002, content);
			default: throw new error_1.VerificationError({
				code: "TLOG_BODY_ERROR",
				message: `unsupported version: ${spec.$case}`
			});
		}
	}
	function verifyDSSE001TLogBody(tlogEntry, content) {
		if (tlogEntry.spec.signatures?.length !== 1) throw new error_1.VerificationError({
			code: "TLOG_BODY_ERROR",
			message: "signature count mismatch"
		});
		let tlogSig = tlogEntry.spec.signatures[0].signature;
		if (!content.compareSignature(Buffer.from(tlogSig, "base64"))) throw new error_1.VerificationError({
			code: "TLOG_BODY_ERROR",
			message: "tlog entry signature mismatch"
		});
		let tlogHash = tlogEntry.spec.payloadHash?.value || "";
		if (!content.compareDigest(Buffer.from(tlogHash, "hex"))) throw new error_1.VerificationError({
			code: "TLOG_BODY_ERROR",
			message: "DSSE payload hash mismatch"
		});
	}
	function verifyDSSE002TLogBody(spec, content) {
		if (spec.signatures?.length !== 1) throw new error_1.VerificationError({
			code: "TLOG_BODY_ERROR",
			message: "signature count mismatch"
		});
		let tlogSig = spec.signatures[0].content;
		if (!content.compareSignature(tlogSig)) throw new error_1.VerificationError({
			code: "TLOG_BODY_ERROR",
			message: "tlog entry signature mismatch"
		});
		let tlogHash = spec.payloadHash?.digest || Buffer.from("");
		if (!content.compareDigest(tlogHash)) throw new error_1.VerificationError({
			code: "TLOG_BODY_ERROR",
			message: "DSSE payload hash mismatch"
		});
	}
})), require_hashedrekord = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.HASHEDREKORD_API_VERSION_V1 = void 0, exports.verifyHashedRekordTLogBody = verifyHashedRekordTLogBody, exports.verifyHashedRekordTLogBodyV2 = verifyHashedRekordTLogBodyV2;
	let error_1 = require_error();
	exports.HASHEDREKORD_API_VERSION_V1 = "0.0.1";
	function verifyHashedRekordTLogBody(tlogEntry, content) {
		switch (tlogEntry.apiVersion) {
			case exports.HASHEDREKORD_API_VERSION_V1: return verifyHashedrekord001TLogBody(tlogEntry, content);
			default: throw new error_1.VerificationError({
				code: "TLOG_BODY_ERROR",
				message: `unsupported hashedrekord version: ${tlogEntry.apiVersion}`
			});
		}
	}
	function verifyHashedRekordTLogBodyV2(tlogEntry, content) {
		let spec = tlogEntry.spec?.spec;
		if (!spec) throw new error_1.VerificationError({
			code: "TLOG_BODY_ERROR",
			message: "missing dsse spec"
		});
		switch (spec.$case) {
			case "hashedRekordV002": return verifyHashedrekord002TLogBody(spec.hashedRekordV002, content);
			default: throw new error_1.VerificationError({
				code: "TLOG_BODY_ERROR",
				message: `unsupported version: ${spec.$case}`
			});
		}
	}
	function verifyHashedrekord001TLogBody(tlogEntry, content) {
		let tlogSig = tlogEntry.spec.signature.content || "";
		if (!content.compareSignature(Buffer.from(tlogSig, "base64"))) throw new error_1.VerificationError({
			code: "TLOG_BODY_ERROR",
			message: "signature mismatch"
		});
		let tlogDigest = tlogEntry.spec.data.hash?.value || "";
		if (!content.compareSignedDigest(Buffer.from(tlogDigest, "hex"))) throw new error_1.VerificationError({
			code: "TLOG_BODY_ERROR",
			message: "digest mismatch"
		});
	}
	function verifyHashedrekord002TLogBody(spec, content) {
		let tlogSig = spec.signature?.content || Buffer.from("");
		if (!content.compareSignature(tlogSig)) throw new error_1.VerificationError({
			code: "TLOG_BODY_ERROR",
			message: "signature mismatch"
		});
		let tlogHash = spec.data?.digest || Buffer.from("");
		if (!content.compareSignedDigest(tlogHash)) throw new error_1.VerificationError({
			code: "TLOG_BODY_ERROR",
			message: "digest mismatch"
		});
	}
})), require_intoto = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.verifyIntotoTLogBody = verifyIntotoTLogBody;
	let error_1 = require_error();
	function verifyIntotoTLogBody(tlogEntry, content) {
		switch (tlogEntry.apiVersion) {
			case "0.0.2": return verifyIntoto002TLogBody(tlogEntry, content);
			default: throw new error_1.VerificationError({
				code: "TLOG_BODY_ERROR",
				message: `unsupported intoto version: ${tlogEntry.apiVersion}`
			});
		}
	}
	function verifyIntoto002TLogBody(tlogEntry, content) {
		if (tlogEntry.spec.content.envelope.signatures?.length !== 1) throw new error_1.VerificationError({
			code: "TLOG_BODY_ERROR",
			message: "signature count mismatch"
		});
		let tlogSig = base64Decode(tlogEntry.spec.content.envelope.signatures[0].sig);
		if (!content.compareSignature(Buffer.from(tlogSig, "base64"))) throw new error_1.VerificationError({
			code: "TLOG_BODY_ERROR",
			message: "tlog entry signature mismatch"
		});
		let tlogHash = tlogEntry.spec.content.payloadHash?.value || "";
		if (!content.compareDigest(Buffer.from(tlogHash, "hex"))) throw new error_1.VerificationError({
			code: "TLOG_BODY_ERROR",
			message: "DSSE payload hash mismatch"
		});
	}
	function base64Decode(str) {
		return Buffer.from(str, "base64").toString("utf-8");
	}
})), require_checkpoint = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.LogCheckpoint = void 0, exports.verifyCheckpoint = verifyCheckpoint;
	let core_1 = require_dist$1(), error_1 = require_error(), SIGNATURE_REGEX = /\u2014 (\S+) (\S+)\n/g;
	function verifyCheckpoint(entry, tlogs) {
		let inclusionProof = entry.inclusionProof, signedNote = SignedNote.fromString(inclusionProof.checkpoint.envelope), checkpoint = LogCheckpoint.fromString(signedNote.note);
		if (!verifySignedNote(signedNote, tlogs)) throw new error_1.VerificationError({
			code: "TLOG_INCLUSION_PROOF_ERROR",
			message: "invalid checkpoint signature"
		});
		return checkpoint;
	}
	function verifySignedNote(signedNote, tlogs) {
		let data = Buffer.from(signedNote.note, "utf-8");
		return signedNote.signatures.some((signature) => {
			let tlog = tlogs.find((tlog) => core_1.crypto.bufferEqual(tlog.logID.subarray(0, 4), signature.keyHint) && tlog.baseURL.includes(signature.name));
			return tlog ? core_1.crypto.verify(data, tlog.publicKey, signature.signature) : !1;
		});
	}
	var SignedNote = class SignedNote {
		note;
		signatures;
		constructor(note, signatures) {
			this.note = note, this.signatures = signatures;
		}
		static fromString(envelope) {
			if (!envelope.includes("\n\n")) throw new error_1.VerificationError({
				code: "TLOG_INCLUSION_PROOF_ERROR",
				message: "missing checkpoint separator"
			});
			let split = envelope.indexOf("\n\n"), header = envelope.slice(0, split + 1), matches = envelope.slice(split + 2).matchAll(SIGNATURE_REGEX), signatures = Array.from(matches, (match) => {
				let [, name, signature] = match, sigBytes = Buffer.from(signature, "base64");
				if (sigBytes.length < 5) throw new error_1.VerificationError({
					code: "TLOG_INCLUSION_PROOF_ERROR",
					message: "malformed checkpoint signature"
				});
				return {
					name,
					keyHint: sigBytes.subarray(0, 4),
					signature: sigBytes.subarray(4)
				};
			});
			if (signatures.length === 0) throw new error_1.VerificationError({
				code: "TLOG_INCLUSION_PROOF_ERROR",
				message: "no signatures found in checkpoint"
			});
			return new SignedNote(header, signatures);
		}
	}, LogCheckpoint = class LogCheckpoint {
		origin;
		logSize;
		logHash;
		rest;
		constructor(origin, logSize, logHash, rest) {
			this.origin = origin, this.logSize = logSize, this.logHash = logHash, this.rest = rest;
		}
		static fromString(note) {
			let lines = note.trimEnd().split("\n");
			if (lines.length < 3) throw new error_1.VerificationError({
				code: "TLOG_INCLUSION_PROOF_ERROR",
				message: "too few lines in checkpoint header"
			});
			let origin = lines[0], logSize;
			try {
				logSize = BigInt(lines[1]);
			} catch {
				throw new error_1.VerificationError({
					code: "TLOG_INCLUSION_PROOF_ERROR",
					message: "invalid checkpoint log size"
				});
			}
			let rootHash = Buffer.from(lines[2], "base64"), rest = lines.slice(3);
			return new LogCheckpoint(origin, logSize, rootHash, rest);
		}
	};
	exports.LogCheckpoint = LogCheckpoint;
})), require_merkle = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.verifyMerkleInclusion = verifyMerkleInclusion;
	let core_1 = require_dist$1(), error_1 = require_error(), RFC6962_LEAF_HASH_PREFIX = Buffer.from([0]), RFC6962_NODE_HASH_PREFIX = Buffer.from([1]);
	function verifyMerkleInclusion(entry, checkpoint) {
		let inclusionProof = entry.inclusionProof, logIndex;
		try {
			logIndex = BigInt(inclusionProof.logIndex);
		} catch {
			throw new error_1.VerificationError({
				code: "TLOG_INCLUSION_PROOF_ERROR",
				message: "invalid inclusion proof log index"
			});
		}
		let treeSize = BigInt(checkpoint.logSize);
		if (logIndex < 0n || logIndex >= treeSize) throw new error_1.VerificationError({
			code: "TLOG_INCLUSION_PROOF_ERROR",
			message: `invalid index: ${logIndex}`
		});
		let { inner, border } = decompInclProof(logIndex, treeSize);
		if (inclusionProof.hashes.length !== inner + border) throw new error_1.VerificationError({
			code: "TLOG_INCLUSION_PROOF_ERROR",
			message: "invalid hash count"
		});
		let innerHashes = inclusionProof.hashes.slice(0, inner), borderHashes = inclusionProof.hashes.slice(inner), calculatedHash = chainBorderRight(chainInner(hashLeaf(entry.canonicalizedBody), innerHashes, logIndex), borderHashes);
		if (!core_1.crypto.bufferEqual(calculatedHash, checkpoint.logHash)) throw new error_1.VerificationError({
			code: "TLOG_INCLUSION_PROOF_ERROR",
			message: "calculated root hash does not match inclusion proof"
		});
	}
	function decompInclProof(index, size) {
		let inner = innerProofSize(index, size);
		return {
			inner,
			border: onesCount(index >> BigInt(inner))
		};
	}
	function chainInner(seed, hashes, index) {
		return hashes.reduce((acc, h, i) => index >> BigInt(i) & BigInt(1) ? hashChildren(h, acc) : hashChildren(acc, h), seed);
	}
	function chainBorderRight(seed, hashes) {
		return hashes.reduce((acc, h) => hashChildren(h, acc), seed);
	}
	function innerProofSize(index, size) {
		return bitLength(index ^ size - BigInt(1));
	}
	function onesCount(num) {
		return num.toString(2).split("1").length - 1;
	}
	function bitLength(n) {
		return n === 0n ? 0 : n.toString(2).length;
	}
	function hashChildren(left, right) {
		return core_1.crypto.digest("sha256", RFC6962_NODE_HASH_PREFIX, left, right);
	}
	function hashLeaf(leaf) {
		return core_1.crypto.digest("sha256", RFC6962_LEAF_HASH_PREFIX, leaf);
	}
})), require_set = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.verifyTLogSET = verifyTLogSET;
	let core_1 = require_dist$1(), error_1 = require_error(), trust_1 = require_trust();
	function verifyTLogSET(entry, tlogs) {
		if (!(0, trust_1.filterTLogAuthorities)(tlogs, {
			logID: entry.logId.keyId,
			targetDate: new Date(Number(entry.integratedTime) * 1e3)
		}).some((tlog) => {
			let payload = toVerificationPayload(entry), data = Buffer.from(core_1.json.canonicalize(payload), "utf8"), signature = entry.inclusionPromise.signedEntryTimestamp;
			return core_1.crypto.verify(data, tlog.publicKey, signature);
		})) throw new error_1.VerificationError({
			code: "TLOG_INCLUSION_PROMISE_ERROR",
			message: "inclusion promise could not be verified"
		});
	}
	function toVerificationPayload(entry) {
		let { integratedTime, logIndex, logId, canonicalizedBody } = entry;
		return {
			body: canonicalizedBody.toString("base64"),
			integratedTime: Number(integratedTime),
			logIndex: Number(logIndex),
			logID: logId.keyId.toString("hex")
		};
	}
})), require_tlog = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.verifyTLogBody = verifyTLogBody, exports.verifyTLogInclusion = verifyTLogInclusion;
	let v2_1 = require_v2(), error_1 = require_error(), dsse_1 = require_dsse(), hashedrekord_1 = require_hashedrekord(), intoto_1 = require_intoto(), checkpoint_1 = require_checkpoint(), merkle_1 = require_merkle(), set_1 = require_set();
	function verifyTLogBody(entry, sigContent) {
		let { kind, version } = entry.kindVersion, body;
		try {
			body = JSON.parse(entry.canonicalizedBody.toString("utf8"));
		} catch {
			throw new error_1.VerificationError({
				code: "TLOG_BODY_ERROR",
				message: "invalid canonicalized body"
			});
		}
		if (kind !== body.kind || version !== body.apiVersion) throw new error_1.VerificationError({
			code: "TLOG_BODY_ERROR",
			message: `kind/version mismatch - expected: ${kind}/${version}, received: ${body.kind}/${body.apiVersion}`
		});
		switch (kind) {
			case "dsse":
				if (version == dsse_1.DSSE_API_VERSION_V1) return (0, dsse_1.verifyDSSETLogBody)(body, sigContent);
				{
					let entryRekorV2 = v2_1.Entry.fromJSON(body);
					return (0, dsse_1.verifyDSSETLogBodyV2)(entryRekorV2, sigContent);
				}
			case "intoto": return (0, intoto_1.verifyIntotoTLogBody)(body, sigContent);
			case "hashedrekord":
				if (version == hashedrekord_1.HASHEDREKORD_API_VERSION_V1) return (0, hashedrekord_1.verifyHashedRekordTLogBody)(body, sigContent);
				{
					let entryRekorV2 = v2_1.Entry.fromJSON(body);
					return (0, hashedrekord_1.verifyHashedRekordTLogBodyV2)(entryRekorV2, sigContent);
				}
			default: throw new error_1.VerificationError({
				code: "TLOG_BODY_ERROR",
				message: `unsupported kind: ${kind}`
			});
		}
	}
	function verifyTLogInclusion(entry, tlogAuthorities) {
		let inclusionVerified = !1;
		if (isTLogEntryWithInclusionPromise(entry) && ((0, set_1.verifyTLogSET)(entry, tlogAuthorities), inclusionVerified = !0), isTLogEntryWithInclusionProof(entry)) {
			let checkpoint = (0, checkpoint_1.verifyCheckpoint)(entry, tlogAuthorities);
			(0, merkle_1.verifyMerkleInclusion)(entry, checkpoint), inclusionVerified = !0;
		}
		if (!inclusionVerified) throw new error_1.VerificationError({
			code: "TLOG_MISSING_INCLUSION_ERROR",
			message: "inclusion could not be verified"
		});
	}
	function isTLogEntryWithInclusionPromise(entry) {
		return entry.inclusionPromise !== void 0;
	}
	function isTLogEntryWithInclusionProof(entry) {
		return entry.inclusionProof !== void 0;
	}
})), require_verifier = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Verifier = void 0;
	let util_1 = require("util"), error_1 = require_error(), key_1 = require_key(), policy_1 = require_policy(), timestamp_1 = require_timestamp(), tlog_1 = require_tlog();
	exports.Verifier = class {
		trustMaterial;
		options;
		constructor(trustMaterial, options = {}) {
			this.trustMaterial = trustMaterial, this.options = {
				ctlogThreshold: options.ctlogThreshold ?? 1,
				tlogThreshold: options.tlogThreshold ?? 1,
				timestampThreshold: options.timestampThreshold ?? options.tsaThreshold ?? 1,
				tsaThreshold: 0
			};
		}
		verify(entity, policy) {
			let timestamps = this.verifyTimestamps(entity), signer = this.verifySigningKey(entity, timestamps);
			return this.verifyTLogs(entity), this.verifySignature(entity, signer), policy && this.verifyPolicy(policy, signer.identity || {}), signer;
		}
		verifyTimestamps(entity) {
			let timestamps = [];
			for (let timestamp of entity.timestamps) switch (timestamp.$case) {
				case "timestamp-authority":
					timestamps.push((0, timestamp_1.getTSATimestamp)(timestamp.timestamp, entity.signature.signature, this.trustMaterial.timestampAuthorities));
					break;
				case "transparency-log": {
					let result = (0, timestamp_1.getTLogTimestamp)(timestamp.tlogEntry);
					result && timestamps.push(result);
					break;
				}
			}
			if (containsDupes(timestamps)) throw new error_1.VerificationError({
				code: "TIMESTAMP_ERROR",
				message: "duplicate timestamp"
			});
			if (timestamps.length < this.options.timestampThreshold) throw new error_1.VerificationError({
				code: "TIMESTAMP_ERROR",
				message: `expected ${this.options.timestampThreshold} timestamps, got ${timestamps.length}`
			});
			return timestamps.map((t) => t.timestamp);
		}
		verifySigningKey({ key }, timestamps) {
			switch (key.$case) {
				case "public-key": return (0, key_1.verifyPublicKey)(key.hint, timestamps, this.trustMaterial);
				case "certificate": {
					let result = (0, key_1.verifyCertificate)(key.certificate, timestamps, this.trustMaterial);
					if (containsDupes(result.scts)) throw new error_1.VerificationError({
						code: "CERTIFICATE_ERROR",
						message: "duplicate SCT"
					});
					if (result.scts.length < this.options.ctlogThreshold) throw new error_1.VerificationError({
						code: "CERTIFICATE_ERROR",
						message: `expected ${this.options.ctlogThreshold} SCTs, got ${result.scts.length}`
					});
					return result.signer;
				}
			}
		}
		verifyTLogs({ signature: content, tlogEntries }) {
			let entryIDs = [];
			if (tlogEntries.forEach((entry) => {
				(0, tlog_1.verifyTLogInclusion)(entry, this.trustMaterial.tlogs), (0, tlog_1.verifyTLogBody)(entry, content), entryIDs.push({
					logID: entry.logId.keyId,
					logIndex: entry.logIndex
				});
			}), containsDupes(entryIDs)) throw new error_1.VerificationError({
				code: "TLOG_ERROR",
				message: "duplicate tlog entry"
			});
			if (entryIDs.length < this.options.tlogThreshold) throw new error_1.VerificationError({
				code: "TLOG_ERROR",
				message: `expected ${this.options.tlogThreshold} tlog entries, got ${entryIDs.length}`
			});
		}
		verifySignature(entity, signer) {
			if (!entity.signature.verifySignature(signer.key)) throw new error_1.VerificationError({
				code: "SIGNATURE_ERROR",
				message: "signature verification failed"
			});
		}
		verifyPolicy(policy, identity) {
			policy.subjectAlternativeName && (0, policy_1.verifySubjectAlternativeName)(policy.subjectAlternativeName, identity.subjectAlternativeName), policy.extensions && (0, policy_1.verifyExtensions)(policy.extensions, identity.extensions), policy.oids && (0, policy_1.verifyOIDs)(policy.oids, identity.oids);
		}
	};
	function containsDupes(arr) {
		for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) if ((0, util_1.isDeepStrictEqual)(arr[i], arr[j])) return !0;
		return !1;
	}
})), require_dist = __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Verifier = exports.toTrustMaterial = exports.VerificationError = exports.PolicyError = exports.toSignedEntity = void 0;
	var bundle_1 = require_bundle();
	Object.defineProperty(exports, "toSignedEntity", {
		enumerable: !0,
		get: function() {
			return bundle_1.toSignedEntity;
		}
	});
	var error_1 = require_error();
	Object.defineProperty(exports, "PolicyError", {
		enumerable: !0,
		get: function() {
			return error_1.PolicyError;
		}
	}), Object.defineProperty(exports, "VerificationError", {
		enumerable: !0,
		get: function() {
			return error_1.VerificationError;
		}
	});
	var trust_1 = require_trust();
	Object.defineProperty(exports, "toTrustMaterial", {
		enumerable: !0,
		get: function() {
			return trust_1.toTrustMaterial;
		}
	});
	var verifier_1 = require_verifier();
	Object.defineProperty(exports, "Verifier", {
		enumerable: !0,
		get: function() {
			return verifier_1.Verifier;
		}
	});
})), import_dist = require_dist$5(), import_dist$1 = require_dist$2(), import_dist$2 = require_dist();
const derUtf8 = (s) => String.fromCharCode(12, s.length) + s;
function assertSignedDigest(envelope, expectedDigest) {
	if (envelope.payload.length === 0) throw new VerifyImageError("Bundle is missing a signed payload", "VERIFY_FAILED");
	try {
		let sl = JSON.parse(envelope.payload.toString("utf8"));
		if (envelope.payloadType === "application/vnd.in-toto+json") {
			let subjects = sl?.subject ?? [];
			if (!subjects.some((s) => s?.digest?.sha256 && `sha256:${s.digest.sha256}` === expectedDigest)) throw new VerifyImageError(`Signed digest (${subjects.map((s) => s?.digest?.sha256 ? `sha256:${s.digest.sha256}` : null).filter(Boolean).join(", ") || "missing"}) does not match fetched digest (${expectedDigest}). The bundle may have been re-attached to a different image.`, "VERIFY_FAILED");
		} else {
			let signedDigest = sl?.critical?.image?.["docker-manifest-digest"];
			if (!signedDigest || signedDigest !== expectedDigest) throw new VerifyImageError(`Signed digest (${signedDigest ?? "missing"}) does not match fetched digest (${expectedDigest}). The bundle may have been re-attached to a different image.`, "VERIFY_FAILED");
		}
	} catch (err) {
		throw err instanceof VerifyImageError ? err : new VerifyImageError("Failed to parse signed payload from bundle", "VERIFY_FAILED");
	}
}
//#endregion
//#region src/core/lib/provenance/sigstore.ts
async function fetchTrustedRoot() {
	let cachePath = await (0, node_fs_promises.mkdtemp)((0, node_path.join)(process.env.RUNNER_TEMP || (0, node_os.tmpdir)(), "buildcage-tuf-"));
	try {
		return await (0, import_dist$1.getTrustedRoot)({ cachePath });
	} finally {
		await (0, node_fs_promises.rm)(cachePath, {
			recursive: !0,
			force: !0
		});
	}
}
async function verifyBundle(bundleJson, options, expectedDigest) {
	let trustedRoot = await fetchTrustedRoot(), verifier = new import_dist$2.Verifier((0, import_dist$2.toTrustMaterial)(trustedRoot), {
		ctlogThreshold: options.ctLogThreshold,
		tlogThreshold: options.tlogThreshold
	}), policy = {};
	options.certificateIdentityURI && (policy.subjectAlternativeName = options.certificateIdentityURI), options.certificateIssuer && (policy.extensions = { issuer: options.certificateIssuer }), options.certificateOIDs && (policy.oids = Object.entries(options.certificateOIDs).map(([oid, value]) => ({
		oid: { id: oid.split(".").map(Number) },
		value: Buffer.from(value)
	})));
	let bundle = (0, import_dist.bundleFromJSON)(bundleJson);
	if (bundle.content.$case !== "dsseEnvelope") throw new VerifyImageError("Bundle is not a DSSE envelope", "VERIFY_FAILED");
	try {
		verifier.verify((0, import_dist$2.toSignedEntity)(bundle), policy);
	} catch (err) {
		throw new VerifyImageError(`Image provenance verification failed: ${errorMessage(err)}`, "VERIFY_FAILED");
	}
	assertSignedDigest(bundle.content.dsseEnvelope, expectedDigest);
}
//#endregion
//#region src/core/lib/provenance/verify-policy.ts
const RELEASE_REF = /^v\d+(\.\d+(\.\d+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?)?)?$/, escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseInsensitive = (s) => escapeRegex(s).replace(/[A-Za-z]/g, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`);
function buildVerifyOptions({ actionRef, actionRepo }) {
	let sanPrefix = `^${escapeRegex("https://github.com/")}${caseInsensitive(actionRepo)}${escapeRegex("/.github/workflows/docker-publish.yml@refs/tags/")}`, base = {
		certificateIssuer: "https://token.actions.githubusercontent.com",
		tlogThreshold: 1,
		ctLogThreshold: 1
	};
	return /^[0-9a-f]{40}$/i.test(actionRef) ? {
		...base,
		certificateIdentityURI: `${sanPrefix}v`,
		certificateOIDs: { "1.3.6.1.4.1.57264.1.13": derUtf8(actionRef.toLowerCase()) }
	} : RELEASE_REF.test(actionRef) ? {
		...base,
		certificateIdentityURI: `${sanPrefix}${escapeRegex(actionRef)}(\\.|$)`
	} : null;
}
//#endregion
//#region src/core/lib/provenance/verify-image.ts
const REGISTRY = "ghcr.io";
async function verifyImageDigest({ actionRef, actionRepo, proxyEngine = "inspect" }) {
	let repoPath = actionRepo.toLowerCase(), verifyOptions = buildVerifyOptions({
		actionRef,
		actionRepo
	});
	if (!verifyOptions) return null;
	let tag = imageTagFromRef(actionRef, proxyEngine), regToken = await fetchRegistryToken(REGISTRY, repoPath, readGhcrBasicAuth()), digest = await fetchManifestDigest(REGISTRY, repoPath, tag, regToken), bundle = await fetchBundle(REGISTRY, repoPath, digest, regToken), labels = await fetchImageConfigLabels(REGISTRY, repoPath, digest, regToken);
	return await verifyBundle(bundle, verifyOptions, digest), checkImageEngine({
		labels,
		proxyEngine,
		imageTag: tag
	}), digest;
}
function toProvenanceError(e) {
	return e instanceof VerifyImageError ? new ProvenanceError(e.message, e.code) : new ProvenanceError(errorMessage(e), "VERIFY_FAILED");
}
function requireDigest(digest, actionRef) {
	if (digest === null) throw new ProvenanceError(`Cannot verify image provenance for ref: ${JSON.stringify(actionRef)}. Pin the action to a version tag (e.g. @v2.1.0) or a commit SHA.`, "UNVERIFIABLE_REF");
	return digest;
}
async function verifyImageDigestOrThrow({ actionRef, actionRepo, proxyEngine }) {
	let digest;
	try {
		digest = await verifyImageDigest({
			actionRef,
			actionRepo,
			proxyEngine
		});
	} catch (e) {
		throw toProvenanceError(e);
	}
	return requireDigest(digest, actionRef);
}
const LIST_INPUTS = [
	"allowed_https_rules",
	"allowed_http_rules",
	"allowed_ip_rules",
	"allowed_url_rules",
	"allowed_tls_rules",
	"known_blocked_rules"
], CONFIG_FILE_INPUTS = {
	known: [
		"builder_name",
		"proxy_mode",
		"proxy_engine",
		...LIST_INPUTS,
		"fail_on_ca_residue",
		"fail_on_blocked",
		"upload_traffic_artifact",
		"traffic_artifact_retention_days"
	],
	lists: LIST_INPUTS
};
//#endregion
//#region src/core/lib/docker/health.ts
function buildDockerInspectStateArgs(containerName) {
	return [
		"inspect",
		"--format",
		"{{json .State}}",
		containerName
	];
}
function parseContainerState(inspectOutput) {
	let raw;
	try {
		raw = JSON.parse(inspectOutput);
	} catch {
		return null;
	}
	if (!raw || typeof raw != "object" || typeof raw.Status != "string") return null;
	let log = Array.isArray(raw.Health?.Log) ? raw.Health.Log : [], lastOutput = log.length > 0 ? log[log.length - 1]?.Output : void 0;
	return {
		status: raw.Status,
		exitCode: typeof raw.ExitCode == "number" ? raw.ExitCode : null,
		health: typeof raw.Health?.Status == "string" ? raw.Health.Status : null,
		lastHealthOutput: typeof lastOutput == "string" && lastOutput.trim() || null
	};
}
function isContainerReady(state) {
	return state.status === "running" && state.health !== "unhealthy" && state.health !== "starting";
}
function describeContainerStartFailure(state, { role, containerName }) {
	let subject = `Buildcage's ${role} container (${containerName})`, probe = state.lastHealthOutput ? ` Last health check output: ${JSON.stringify(state.lastHealthOutput)}.` : "", evidence = " Its log is printed above.";
	return state.status === "running" ? isContainerReady(state) ? `${subject} is running, but \`docker compose up\` failed. See the Docker output above.${probe}` : `${subject} started but never became ready.${probe}${evidence}` : `${subject} stopped${state.exitCode === null ? "" : ` with code ${state.exitCode}`} instead of starting up.${probe}${evidence}`;
}
//#endregion
//#region src/lib/errors.ts
var SetupError = class extends ActionError {};
//#endregion
//#region src/lib/builder-diagnostics.ts
const captureDockerViaExec = (args, env) => (0, node_child_process.execFileSync)("docker", args, {
	encoding: "utf8",
	env,
	stdio: [
		"ignore",
		"pipe",
		"pipe"
	]
}), printDockerViaExec = (args, env) => {
	(0, node_child_process.execFileSync)("docker", args, {
		stdio: "inherit",
		env
	});
};
function builderStartError(e, { composeFile, projectName, builderName, composeEnv }, deps = {}) {
	let state = readBuilderState(builderName, composeEnv, deps);
	return state ? (printBuilderLog({
		composeFile,
		projectName,
		composeEnv
	}, deps), new SetupError(describeContainerStartFailure(state, {
		role: "builder",
		containerName: builderName
	}), "BUILDER_NOT_READY")) : new SetupError(describeDockerFailure(e, { operation: "docker compose up" }), "DOCKER_UNAVAILABLE");
}
function readBuilderState(builderName, composeEnv, { captureDocker = captureDockerViaExec }) {
	try {
		return parseContainerState(captureDocker(buildDockerInspectStateArgs(builderName), composeEnv));
	} catch (e) {
		return reportInspectFailure(e), null;
	}
}
function reportInspectFailure(e) {
	let stderr = capturedStderr(e);
	stderr && !/no such object/i.test(stderr) && console.log(`buildcage: could not read the builder container's state: ${stderr}`);
}
function printBuilderLog({ composeFile, projectName, composeEnv }, { printDocker = printDockerViaExec }) {
	withLogGroup("buildcage: Builder container log", () => {
		try {
			printDocker(buildComposeLogsArgs({
				composeFile,
				projectName,
				tail: 100
			}), composeEnv);
		} catch {
			console.log("The builder container's log could not be read.");
		}
	});
}
//#endregion
//#region src/core/lib/docker/host-addresses.ts
function listHostIpv4Addresses({ networkInterfaces: list = node_os.networkInterfaces } = {}) {
	let found = new Set();
	for (let infos of Object.values(list())) for (let info of infos ?? []) (info.family === "IPv4" || info.family === 4) && (info.internal || found.add(info.address));
	return [...found].sort();
}
//#endregion
//#region src/lib/compose-env.ts
function buildComposeEnv({ builderName, proxyMode, proxyEngine, failOnCaResidue, imageRef, httpsRules, httpRules, ipRules, urlRules, tlsRules, knownBlockedRules }, env, hostAddresses = listHostIpv4Addresses) {
	return {
		...env,
		BUILDER_NAME: builderName,
		PROXY_MODE: proxyMode,
		PROXY_ENGINE: proxyEngine,
		FAIL_ON_CA_RESIDUE: String(failOnCaResidue),
		ALLOWED_HTTPS_RULES: httpsRules.join("\n"),
		ALLOWED_HTTP_RULES: httpRules.join("\n"),
		ALLOWED_IP_RULES: ipRules.join("\n"),
		ALLOWED_URL_RULES: urlRules.join("\n"),
		ALLOWED_TLS_RULES: tlsRules.join("\n"),
		KNOWN_BLOCKED_RULES: knownBlockedRules.join("\n"),
		BUILDCAGE_IMAGE_REF: imageRef,
		HOST_ADDRESSES: hostAddresses().join(" ")
	};
}
//#endregion
//#region src/core/lib/acl/coredns-config.ts
function escapeForCel(regex) {
	return regex.replace(/\\/g, "\\\\");
}
function nameMatches(regex) {
	return `      expr name() matches '(?i)${regex}'`;
}
function proxyAnswerLines(proxyAddress, ttlSeconds) {
	return [
		"    template IN A {",
		`      answer "{{ .Name }} ${ttlSeconds} IN A ${proxyAddress}"`,
		"    }",
		"    template IN AAAA {",
		"    }",
		"    template IN ANY {",
		"    }"
	];
}
function reverseZoneLines(proxyAddress, ttlSeconds) {
	let soa = `{{ .Zone }} ${ttlSeconds} IN SOA ns.buildcage.invalid. hostmaster.buildcage.invalid. 1 ${ttlSeconds} ${ttlSeconds} ${ttlSeconds} ${ttlSeconds}`;
	return [
		"# Reverse lookups: answered NXDOMAIN rather than left unhandled, which",
		"# would be SERVFAIL and cost musl a five-second timeout each time. Only a",
		"# reversed address is treated this way; anything else",
		"# under these zones misses the view and falls through to the blocks below.",
		"in-addr.arpa ip6.arpa {",
		"    view reverse {",
		nameMatches("^(([0-9]{1,3}[.]){1,4}in-addr[.]arpa|([0-9a-fA-F][.]){1,32}ip6[.]arpa)[.]$"),
		"    }",
		"    template IN PTR {",
		"      rcode NXDOMAIN",
		`      authority "${soa}"`,
		"    }",
		...proxyAnswerLines(proxyAddress, ttlSeconds),
		"    log . \"buildcage dns reverse name={name}\"",
		"    errors",
		"}",
		""
	];
}
const SERVICE_PREFIX_REGEX = "_[a-z0-9-]{1,15}[.]_(tcp|udp|sctp)[.]", DISCOVERY_TYPES = [
	"SRV",
	"TXT",
	"TLSA",
	"URI"
];
function discoveryZoneLines(proxyAddress, ttlSeconds, parentRegex) {
	let parent = parentRegex === void 0 ? ".+" : `(${escapeForCel(parentRegex)})`;
	return [
		"# Service-discovery names under an allowed host: answered NODATA and logged",
		"# under a verb of their own. No rule can permit one, so a denied row for it",
		"# could never be taken away. A service name under any other host misses the",
		"# view and is denied below, as the host itself would be. Both expressions",
		"# have to hold: a type not defined at a service name is judged below like",
		"# any other lookup rather than exempted on a guess.",
		". {",
		"    view discovery {",
		nameMatches(`^${SERVICE_PREFIX_REGEX}${parent}[.]$`),
		`      expr type() in [${DISCOVERY_TYPES.map((t) => `'${t}'`).join(", ")}]`,
		"    }",
		...proxyAnswerLines(proxyAddress, ttlSeconds),
		"    log . \"buildcage dns discovery name={name} type={type}\"",
		"    errors",
		"}",
		""
	];
}
function serviceZoneLines(proxyAddress, ttlSeconds) {
	return [
		"# Every other service name: refused like any other name, but recorded apart",
		"# so the report can say the remedy is the host below it rather than the name",
		"# itself, which no rule can make resolve.",
		". {",
		"    view service {",
		nameMatches(`^${SERVICE_PREFIX_REGEX}.+[.]$`),
		"    }",
		...proxyAnswerLines(proxyAddress, ttlSeconds),
		"    log . \"buildcage dns service-denied name={name} type={type}\"",
		"    errors",
		"}",
		""
	];
}
const HEALTH_LINE = "    health 127.0.0.1:8080";
function generateCorednsConfig(rules, options) {
	let { proxyAddress, ttlSeconds = 60, mode = "restrict" } = options, hostRegexes = rules.resolverHosts;
	if (mode === "audit") return [
		"# Generated by buildcage. Do not edit.",
		"",
		...reverseZoneLines(proxyAddress, ttlSeconds),
		...discoveryZoneLines(proxyAddress, ttlSeconds, void 0),
		"# audit enforces nothing, so every name is logged as allowed. It is still",
		"# answered locally with the proxy's own address, so a name that was only",
		"# looked up, never connected to, still shows up here, and the query",
		"# itself never reaches a real nameserver.",
		". {",
		HEALTH_LINE,
		...proxyAnswerLines(proxyAddress, ttlSeconds),
		"    log . \"buildcage dns allowed name={name}\"",
		"    errors",
		"}",
		""
	].join("\n");
	let lines = ["# Generated by buildcage. Do not edit.", ""];
	if (lines.push(...reverseZoneLines(proxyAddress, ttlSeconds)), hostRegexes.length > 0) {
		let alternation = hostRegexes.map((r) => `(${r})`).join("|");
		lines.push(...discoveryZoneLines(proxyAddress, ttlSeconds, alternation)), lines.push("# Allowlisted names are logged as allowed, but answered exactly like a", "# denied one, with the proxy's own address: real resolution happens once", "# a request has already passed HAProxy's own host+path+method check, not", "# here. The expression is the same host pattern the proxy rules are built", "# from, so the two cannot drift apart.", ". {", "    view allowlist {", nameMatches(`^(${escapeForCel(alternation)})[.]$`), "    }", ...proxyAnswerLines(proxyAddress, ttlSeconds), "    log . \"buildcage dns allowed name={name}\"", "    errors", "}", "");
	}
	return lines.push(...serviceZoneLines(proxyAddress, ttlSeconds)), lines.push("# Everything else resolves to the proxy and is answered locally, so the", "# query never leaves and the request still arrives somewhere its full URL", "# can be recorded before being denied.", ". {", HEALTH_LINE, ...proxyAnswerLines(proxyAddress, ttlSeconds), "    log . \"buildcage dns denied name={name}\"", "    errors", "}", ""), lines.join("\n");
}
//#endregion
//#region src/core/lib/log/proxy-address.ts
const PROXY_SUBNET = "198.19.255.0/24";
//#endregion
//#region src/core/lib/acl/haproxy-internal-dst.ts
function internalDstAcl(name, opts, fetch = "var(txn.dst)") {
	return [`    acl ${name} ${fetch} -m ip ${opts.internalAddrs.join(" ")}`, ...opts.hostAddressFile ? [`    acl ${name} ${fetch} -m ip -f ${opts.hostAddressFile}`] : []];
}
//#endregion
//#region src/core/lib/acl/haproxy-matchers.ts
const HOSTNAME_CHARSET = "^[A-Za-z0-9._-]+$";
function escapeForHaproxy(value) {
	return value.replace(/[\\#'" ]/g, "\\$&");
}
const LITERAL_BODY = /^(?:[A-Za-z0-9_~:@%\-/]|\\\.)*$/;
function unescape(body) {
	return body.replace(/\\\./g, ".");
}
function hostMatcher(hostRegex) {
	let body = /^\^(.+)\$$/.exec(hostRegex)?.[1];
	return body !== void 0 && LITERAL_BODY.test(body) ? {
		op: "-m str",
		pattern: unescape(body).toLowerCase()
	} : {
		op: "-m reg -i",
		pattern: hostRegex
	};
}
function pathMatcher(pathRegex) {
	let asRegex = {
		op: "-m reg",
		pattern: pathRegex
	}, body = pathRegex.slice(1), op = "-m beg";
	return body.endsWith("$") && (body = body.slice(0, -1), op = "-m str", body.endsWith(".*") && (body = body.slice(0, -2), op = "-m beg")), !body.startsWith("/") || !LITERAL_BODY.test(body) ? asRegex : {
		op,
		pattern: unescape(body)
	};
}
//#endregion
//#region src/core/lib/acl/haproxy-detect-frontend.ts
function tlsCond(host) {
	return `${host.id}_sni${host.port ? ` ${host.id}_port` : ""} sni_is_name`;
}
function detectFrontend(spec) {
	let { listenPort, tlsStagePort, plainStagePort, ipRules, tlsHosts, proxyAddress } = spec, hasPassthrough = ipRules.length > 0 || tlsHosts.length > 0, l = [];
	if (l.push("# One listener for everything redirected here. The first bytes say whether", "# this is a handshake or a plain request, so no port has to be declared as", "# one or the other in advance.", "frontend detect", `    bind *:${listenPort}`, "    mode tcp", "    tcp-request inspect-delay 5s", ""), hasPassthrough || l.push("    no log", ""), hasPassthrough) {
		let pass = "{ var(txn.pass) -m found }";
		if (l.push("    # Passed through untouched: judged before anything is decrypted."), ipRules.length > 0) {
			ipRules.some((rule) => rule.hostMatch === "hostPort") && l.push("    tcp-request content set-var-fmt(txn.dst_str) %[dst]:%[dst_port]"), l.push("    # dst is the proxy only when the name went through this container's DNS.", `    acl dns_routed dst ${proxyAddress}`);
			for (let rule of ipRules) l.push(`    # ${rule.raw}`), l.push(rule.hostMatch === "hostPort" ? `    acl ${rule.id}_dst var(txn.dst_str) -m reg ${escapeForHaproxy(rule.address)}` : `    acl ${rule.id}_dst dst ${rule.address}`), rule.port && l.push(`    acl ${rule.id}_port dst_port ${rule.port}`);
			let self = `${pass} ip_dst_internal { dst_port ${listenPort} }`;
			l.push("", ...ipRules.map((r) => `    tcp-request content set-var(txn.pass) int(1) if ${r.id}_dst${r.port ? ` ${r.id}_port` : ""} !dns_routed`), `    tcp-request content set-var(txn.proto) str(tcp) if ${pass}`, ...internalDstAcl("ip_dst_internal", spec, "dst"), `    tcp-request content set-var(txn.reason) str(internal-address) if ${self}`, `    tcp-request content reject if ${self}`, `    tcp-request content accept if ${pass}`);
		}
		if (tlsHosts.length > 0) {
			tlsHosts.some((host) => host.hostMatch === "hostPort") && l.push("    tcp-request content set-var-fmt(txn.sni_port) %[req.ssl_sni]:%[dst_port] if { req.ssl_sni -m found }"), l.push("", `    acl sni_is_name req.ssl_sni -m reg ${HOSTNAME_CHARSET}`);
			for (let host of tlsHosts) l.push(`    # ${host.raw}`), l.push(host.hostMatch === "hostPort" ? `    acl ${host.id}_sni var(txn.sni_port) -m reg -i ${escapeForHaproxy(host.hostRegex)}` : `    acl ${host.id}_sni req.ssl_sni -m reg -i ${escapeForHaproxy(host.hostRegex)}`), host.port && l.push(`    acl ${host.id}_port dst_port ${host.port}`);
			l.push("", ...tlsHosts.map((host) => `    tcp-request content set-var(txn.pass) int(1) if ${tlsCond(host)}`), `    tcp-request content set-var(txn.sni) req.ssl_sni,regsub([^A-Za-z0-9._-],_,g) if ${pass}`, `    tcp-request content set-var(txn.proto) str(tls) if ${pass}`, "", `    tcp-request content do-resolve(txn.dst,buildcage,ipv4) req.ssl_sni,lower if ${pass}`, `    tcp-request content set-var(txn.reason) str(dns-failed) if ${pass} !{ var(txn.dst) -m found }`, `    tcp-request content reject if ${pass} !{ var(txn.dst) -m found }`, "    tcp-request content set-dst var(txn.dst) if { var(txn.dst) -m found }", ...internalDstAcl("pass_dst_internal", spec), `    tcp-request content set-var(txn.reason) str(internal-address) if ${pass} pass_dst_internal`, `    tcp-request content reject if ${pass} pass_dst_internal`);
		}
		l.push("", "    tcp-request content set-log-level silent unless { var(txn.pass) -m found }", "    log-format \"buildcage %[date(0,ms)] pass %[var(txn.proto)] %B ts=%ts reason=%[var(txn.reason)] dst=%[dst]:%[dst_port] sni=%[var(txn.sni)]\"", "");
	}
	return l.push("    # `accept` ends content-rule evaluation, so it comes after every rule", "    # that needs the request buffer (the SNI capture and resolution above).", "    # Separate rules: while a ClientHello is incomplete the first one waits", "    # for the rest, where an `||` would accept on its first segment.", "    tcp-request content accept if { req.ssl_hello_type 1 }", "    tcp-request content accept if { req.len gt 0 }", ""), hasPassthrough && l.push("    use_backend passthrough if { var(txn.pass) -m found }", ""), l.push("    acl is_tls req.ssl_hello_type 1", "    use_backend to_tls if is_tls", "    default_backend to_plain", "", "backend passthrough", "    mode tcp", "    server origin 0.0.0.0", "", "backend to_tls", "    mode tcp", `    server s 127.0.0.1:${tlsStagePort} send-proxy-v2`, "", "backend to_plain", "    mode tcp", `    server s 127.0.0.1:${plainStagePort} send-proxy-v2`, ""), l;
}
//#endregion
//#region src/core/lib/acl/haproxy-rule-block.ts
function deniesEverything(rules, mode) {
	return mode !== "audit" && rules.length === 0;
}
function ruleBlock(rules, mode, scheme) {
	let lines = [];
	if (mode === "audit") return lines.push("    # audit records without enforcing, so nothing is refused here.", ""), lines;
	if (deniesEverything(rules, mode)) return lines.push("    # No rules for this scheme, so nothing is permitted.", "    http-request deny", ""), lines;
	rules.some((r) => r.hostMatch === "hostPort") && lines.push("    http-request set-var-fmt(txn.host_port) %[var(txn.host)]:%[dst_port]"), rules.some((r) => r.hostMatch === "hostBareFull") && lines.push(`    acl is_default_port dst_port ${DEFAULT_PORT[scheme]}`, "    http-request set-var-fmt(txn.host_full) %[var(txn.host)]:%[dst_port]");
	let aclForHost = new Map(), hostAclOf = new Map();
	for (let rule of rules) {
		let hostRegex = escapeForHaproxy(rule.hostRegex);
		if (lines.push(`    # ${rule.raw}`), rule.hostMatch === "hostPort") lines.push(`    acl ${rule.id}_host var(txn.host_port) -m reg -i ${hostRegex}`);
		else if (rule.hostMatch === "hostBareFull") lines.push(`    http-request set-var(txn.${rule.id}_ok) bool(false)`, `    http-request set-var(txn.${rule.id}_ok) bool(true) if is_default_port { var(txn.host) -m reg -i ${hostRegex} }`, `    http-request set-var(txn.${rule.id}_ok) bool(true) if { var(txn.host_full) -m reg -i ${hostRegex} }`, `    acl ${rule.id}_host var(txn.${rule.id}_ok) -m bool`);
		else {
			let host = hostMatcher(rule.hostRegex), shared = aclForHost.get(`${host.op} ${host.pattern}`);
			shared === void 0 && (aclForHost.set(`${host.op} ${host.pattern}`, `${rule.id}_host`), lines.push(`    acl ${rule.id}_host var(txn.host) ${host.op} ${escapeForHaproxy(host.pattern)}`)), hostAclOf.set(rule.id, shared ?? `${rule.id}_host`), rule.port && lines.push(`    acl ${rule.id}_port dst_port ${rule.port}`);
		}
		let path = pathMatcher(rule.pathRegex);
		lines.push(`    acl ${rule.id}_path path ${path.op} ${escapeForHaproxy(path.pattern)}`), rule.methods && lines.push(`    acl ${rule.id}_method method ${rule.methods.join(" ")}`);
	}
	lines.push("");
	let clauses = rules.map((r) => `${hostAclOf.get(r.id) ?? `${r.id}_host`}${r.port ? ` ${r.id}_port` : ""} ${r.id}_path${r.methods ? ` ${r.id}_method` : ""}`);
	lines.push("    http-request set-var(txn.allowed) bool(false)");
	for (let clause of clauses) lines.push(`    http-request set-var(txn.allowed) bool(true) if !{ var(txn.allowed) -m bool } ${clause}`);
	return lines.push("    http-request deny unless { var(txn.allowed) -m bool }"), lines.push(""), lines;
}
//#endregion
//#region src/core/lib/acl/haproxy-rules.ts
const HOST_IS_ADDRESS = `^${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}$`, INTERNAL_RANGES = [
	"0.0.0.0/8",
	"127.0.0.0/8",
	"169.254.0.0/16",
	"100.64.0.0/10",
	"192.0.0.0/24",
	"168.63.129.16/32",
	"::1/128",
	"fe80::/10"
];
function splitHostRule(pattern) {
	let colonIndex = pattern.lastIndexOf(":");
	if (colonIndex === -1) throw Error(`Invalid rule "${pattern}": missing port`);
	let port = pattern.slice(colonIndex + 1);
	checkPort(port, pattern);
	let host = pattern.slice(0, colonIndex);
	if (host.includes(":")) throw Error(`Invalid host in rule "${pattern}": "${host}" holds a ":", so the one this rule was split at is not its port separator. An IPv6 address is not supported here.`);
	return {
		host,
		port
	};
}
function hostOnlyRegexOfRule(pattern) {
	return pattern.startsWith("~") ? splitRawRegexHost(pattern).host : domainToRegexPartial(splitHostRule(pattern).host);
}
function hostOnlyRegexOfUrlRule(rule) {
	let authority = rule.authorityRegex.slice(1, -1);
	return rule.isRegex ? authority : authority.slice(0, authority.lastIndexOf(":"));
}
function urlRuleToMatcher(rule) {
	let hostOnly = hostOnlyRegexOfUrlRule(rule), port = rule.authorityRegex.slice(1, -1).slice(hostOnly.length + 1);
	return {
		hostRegex: `^${hostOnly}$`,
		port: port === "[0-9]+" ? null : port
	};
}
function hostRuleToMatcher(pattern) {
	if (pattern.startsWith("~")) return splitRawRegexHost(pattern), {
		hostMatch: "hostPort",
		hostRegex: anchorRawRegex(pattern.slice(1)),
		port: null
	};
	let { port } = splitHostRule(pattern);
	return {
		hostMatch: "wildcard",
		hostRegex: `^${hostOnlyRegexOfRule(pattern)}$`,
		port: port === "*" ? null : port
	};
}
function compileSchemeRules(hostRules, urlRules, scheme) {
	let out = [];
	for (let pattern of hostRules ?? []) out.push({
		id: "",
		...hostRuleToMatcher(pattern),
		pathRegex: "^/",
		methods: null,
		raw: pattern
	});
	for (let rule of urlRules ?? []) if (rule.schemes.includes(scheme)) {
		if (rule.isRegex) {
			out.push({
				id: "",
				hostMatch: "hostBareFull",
				hostRegex: rule.hostRegex,
				port: null,
				pathRegex: rule.pathRegex,
				methods: rule.methods,
				raw: rule.raw
			});
			continue;
		}
		out.push({
			id: "",
			hostMatch: "wildcard",
			...urlRuleToMatcher(rule),
			pathRegex: rule.pathRegex,
			methods: rule.methods,
			raw: rule.raw
		});
	}
	return out.forEach((rule, i) => {
		rule.id = `${scheme === "https" ? "s" : "p"}${i}`;
	}), out;
}
function compileIpRules(rules) {
	let out = [];
	return (rules ?? []).forEach((rule, index) => {
		if (rule.startsWith("~")) {
			splitRawRegexHost(rule), out.push({
				id: `ip${index}`,
				address: anchorRawRegex(rule.slice(1)),
				hostMatch: "hostPort",
				port: null,
				raw: rule
			});
			return;
		}
		let colonIndex = rule.lastIndexOf(":");
		if (colonIndex === -1) throw Error(`Invalid rule "${rule}": missing port`);
		let address = rule.slice(0, colonIndex), port = rule.slice(colonIndex + 1);
		if (!isIpRuleAddress(address)) throw Error(`Invalid address in rule "${rule}": not an address, CIDR block or address wildcard, which is all that can be tunnelled without inspection`);
		if (checkPort(port, rule), !IPV4_OR_CIDR.test(address)) {
			out.push({
				id: `ip${index}`,
				address: convertRule(rule),
				hostMatch: "hostPort",
				port: null,
				raw: rule
			});
			return;
		}
		out.push({
			id: `ip${index}`,
			address,
			hostMatch: "wildcard",
			port: port === "*" ? null : port,
			raw: rule
		});
	}), out;
}
function compileRuleSet(inputs) {
	return {
		https: compileSchemeRules(inputs.httpsRules, inputs.urlRules, "https"),
		http: compileSchemeRules(inputs.httpRules, inputs.urlRules, "http"),
		ip: compileIpRules(inputs.ipRules),
		tls: (inputs.tlsRules ?? []).map((pattern, index) => ({
			id: `tls${index}`,
			...hostRuleToMatcher(pattern),
			raw: pattern
		})),
		resolverHosts: resolverHosts(inputs)
	};
}
function resolverHosts(inputs) {
	let hosts = [], add = (regex) => {
		hosts.includes(regex) || hosts.push(regex);
	};
	for (let pattern of inputs.httpsRules ?? []) add(hostOnlyRegexOfRule(pattern));
	for (let pattern of inputs.httpRules ?? []) add(hostOnlyRegexOfRule(pattern));
	for (let pattern of inputs.tlsRules ?? []) add(hostOnlyRegexOfRule(pattern));
	for (let rule of inputs.urlRules ?? []) add(hostOnlyRegexOfUrlRule(rule));
	return hosts;
}
//#endregion
//#region src/core/lib/acl/haproxy-inspect-stage.ts
function sniField(scheme) {
	return scheme === "https" ? " sni=%[ssl_fc_sni,regsub([^A-Za-z0-9._-],_,g)]" : "";
}
function addressRules(rules) {
	let isAddress = new RegExp(HOST_IS_ADDRESS);
	return rules.filter((rule) => {
		if (rule.hostMatch !== "wildcard") return !1;
		let { op, pattern } = hostMatcher(rule.hostRegex);
		return op === "-m str" && isAddress.test(pattern);
	});
}
function internalGuard(rules, listenPort) {
	let named = addressRules(rules);
	if (named.length === 0) return [
		"    http-request set-var(txn.reason) str(internal-address) if dst_internal",
		"    http-request deny deny_status 403 if dst_internal",
		""
	];
	let lines = ["    # An address a rule names as its host is exempt where that rule matches."];
	for (let rule of named) {
		let path = pathMatcher(rule.pathRegex), conds = [
			`{ var(txn.host) -m str ${hostMatcher(rule.hostRegex).pattern} }`,
			...rule.port ? [`{ dst_port ${rule.port} }`] : [],
			`{ path ${path.op} ${escapeForHaproxy(path.pattern)} }`,
			...rule.methods ? [`{ method ${rule.methods.join(" ")} }`] : []
		];
		lines.push(`    # ${rule.raw}`, `    http-request set-var(txn.named_address) bool(true) if ${conds.join(" ")}`);
	}
	return lines.push("    acl named_address var(txn.named_address) -m bool", `    acl dst_proxy_self var(txn.dst) -m ip ${PROXY_SUBNET}`, `    acl dst_proxy_self dst_port ${listenPort}`, "    http-request set-var(txn.reason) str(internal-address) if dst_internal !named_address or dst_internal dst_proxy_self", "    http-request deny deny_status 403 if dst_internal !named_address or dst_internal dst_proxy_self", ""), lines;
}
const PLAIN_REQUEST_TIMEOUTS = [
	"    # detect's client timeout runs from the connection, this frontend's from",
	"    # the hand-off after detect's 5s inspect-delay. Ending a silent client's",
	"    # wait here first logs it as a timeout rather than a close. The",
	"    # keep-alive wait stays at the client timeout.",
	"    timeout http-request 20s",
	"    timeout http-keep-alive 30s"
];
function inspectStage({ name, port, bindExtra, scheme, rules, backend }, ctx) {
	let { mode } = ctx, l = [];
	return l.push(`frontend ${name}`, `    bind 127.0.0.1:${port} accept-proxy${bindExtra}`, "    mode http", ...scheme === "http" ? PLAIN_REQUEST_TIMEOUTS : [], "    http-request set-var(txn.host_log) 'req.hdr(host),regsub(\"[\\s\\\"[:cntrl:]]\",_,g)'", "", "    # Decode before stripping `..`: `.` is unreserved, so `%2e%2e` is not", "    # a dot-dot segment until decoded, and stripping first would miss it.", "    http-request normalize-uri percent-decode-unreserved", "    http-request normalize-uri path-strip-dotdot", "", "    # pathq, not %HU: %HU is the target as sent (a path over HTTP/1.1, an", "    # absolute URI over HTTP/2), and pathq is not readable at log time.", "    # Set after normalization, so the log shows the path the rules matched.", "    http-request set-var(txn.pathq) 'pathq,regsub(\"[\\\"[:cntrl:]]\",_,g)'", "", "    # A request with no Host names nothing: the rules match on it, the", "    # origin is resolved from it, and the log's URL is built from it. Named", "    # here rather than left to the log's own empty fields, which a Host the", "    # client chose can imitate. Refused in `audit` too, as the same check", "    # in the universal engine is: there is nothing to connect to either way.", "    # Ahead of the path denies below, so that a request carrying neither a", "    # Host nor a legal path is named by the one the report can act on: the", "    # other leaves a row named for the `-` the log prints in its place.", "    acl has_host hdr(host) -m found", "    acl host_not_empty hdr_len(host) gt 0", "    http-request set-var(txn.reason) str(missing-host-header) if !has_host or !host_not_empty", "    http-request deny deny_status 400 if !has_host or !host_not_empty", "", "    # The one Host every later step reads. An acl on req.hdr(host) scans", "    # every value while a fetch takes the last, so reading the header twice", "    # could judge one value and connect to another.", "    http-request set-var(txn.host) req.hdr(host),lower,host_only,regsub(\\.$,)", "    # A `:` left in the name could let a `~` rule's port pattern match it.", "    # Refused in `audit` too.", `    acl host_is_name var(txn.host) -m reg ${HOSTNAME_CHARSET}`, "    http-request set-var(txn.reason) str(invalid-host) if !host_is_name", "    http-request deny deny_status 400 if !host_is_name", "", "    # `%2f` and `%5c` survive decoding (both reserved) yet an origin may", "    # read `..%2f` / `..%5c` as a segment, and a raw backslash is not a", "    # valid path char at all. None is stripped, so each is refused. A lone", "    # encoded separator stays legal (e.g. npm's `/@scope%2fpackage`).", "    # `;` (or `%3b`) ends a segment too: Tomcat and Jetty drop what follows", "    # as a path parameter, so they read `..;/` as `../`.", "    # `\\\\` is one literal backslash: HAProxy's parser takes the pair as one.", "    http-request deny deny_status 403 if { path -m reg -i (^|/|%2f|%5c)\\.\\.($|/|;|%2f|%5c|%3b) }", "    http-request deny deny_status 403 if { path -m sub \\\\ }", "", `    log-format "buildcage %[date(0,ms)] ${scheme} %HM %ST %B ts=%ts reason=%[var(txn.reason)] tlserr=%[ssl_bc_err] dst=%[dst]:%[dst_port]${sniField(scheme)} host=%[var(txn.host_log)] %[var(txn.pathq)]"`, ""), l.push(...ruleBlock(rules, mode, scheme)), deniesEverything(rules, mode) || l.push("    # Connect to the address this proxy resolves the Host to, discarding", "    # the client's address, so a forged Host or doctored /etc/hosts cannot", "    # choose the target.", "    # txn.host has already dropped the port a header carries, which is not", "    # part of the name. An address is taken as-is: no resolver can answer", "    # one, and the rules above already decided, so nothing is loosened.", `    acl host_is_address var(txn.host) -m reg ${HOST_IS_ADDRESS}`, "    http-request set-var(txn.dst) var(txn.host) if host_is_address", "    http-request do-resolve(txn.dst,buildcage,ipv4) var(txn.host) unless host_is_address", "    # A fresh attempt, not a replay: nothing cached the failure.", "    http-request do-resolve(txn.dst,buildcage,ipv4) var(txn.host) unless host_is_address or { var(txn.dst) -m found }", "    http-request set-var(txn.reason) str(dns-failed) unless { var(txn.dst) -m found }", "    http-request deny deny_status 502 unless { var(txn.dst) -m found }", "", "    # Set before the internal-destination check below, not after: %[dst] in", "    # the log-format is this, and a refusal must show the address that", "    # tripped it, not whatever the client's own (fake, unresolved) address", "    # was: CoreDNS never hands out a real one; see coredns-config.ts.", "    http-request set-dst var(txn.dst)", "", "    # A resolved destination may not be internal; see INTERNAL_RANGES.", ...internalDstAcl("dst_internal", ctx), ...internalGuard(rules, ctx.listenPort)), l.push(`    default_backend ${backend}`, ""), l;
}
//#endregion
//#region src/core/lib/acl/haproxy-sections.ts
function preamble(spec) {
	return [
		"# Generated by buildcage. Do not edit.",
		"",
		"global",
		"    log stdout len 16384 format raw local0",
		"    nbthread 1",
		"    user haproxy",
		"    group haproxy",
		"    dns-accept-family ipv4",
		...spec.global,
		"",
		"defaults",
		"    log global",
		"    timeout connect 5s",
		...spec.defaults,
		"",
		"# Readiness for s6-notifyoncheck, and the dropped-log count for the report.",
		"# Not reachable from the network.",
		"frontend health",
		"    bind /var/run/haproxy-health.sock mode 666",
		"    mode http",
		"    no log",
		"    monitor-uri /health",
		"    http-request use-service prometheus-exporter if { path /metrics }",
		""
	];
}
function resolversSection() {
	return [
		"# Real resolution happens once a request has already passed the rule",
		"# ACLs below; the build's own resolver (CoreDNS) never gives out a real",
		"# answer, so this is the only place a name becomes an address.",
		"resolvers buildcage",
		"    parse-resolv-conf",
		"    hold valid 60s",
		"    resolve_retries 4",
		"    timeout retry 1s",
		"    accepted_payload_size 8192",
		""
	];
}
function originBackends(systemCaFile) {
	return [
		"# The only place a request reaches the origin, so where its certificate is",
		"# checked; a refused request never gets here. The SNI is the port-free",
		"# txn.host the rules judged, since a certificate is verified against a name,",
		"# not a name and port.",
		"backend origin_tls",
		"    mode http",
		`    server origin 0.0.0.0 ssl verify required ca-file ${systemCaFile} sni var(txn.host)`,
		"",
		"backend origin_plain",
		"    mode http",
		"    server origin 0.0.0.0",
		""
	];
}
//#endregion
//#region src/core/lib/acl/haproxy-config.ts
const DEFAULTS = {
	listenPort: 10024,
	caSignFile: "/etc/haproxy/ca.pem",
	defaultCertFile: "/etc/haproxy/default.pem",
	systemCaFile: "/etc/ssl/certs/ca-certificates.crt"
}, TLS_STAGE_PORT = 10025, PLAIN_STAGE_PORT = 10026;
function generateHaproxyConfig(options) {
	let opts = {
		...DEFAULTS,
		...options
	}, mode = opts.mode ?? "restrict", { https: httpsRules, http: httpRules, ip: ipRules, tls: tlsHosts } = compileRuleSet(options), shared = {
		internalAddrs: [
			...INTERNAL_RANGES,
			PROXY_SUBNET,
			opts.proxyAddress
		],
		hostAddressFile: opts.hostAddressFile
	};
	return [
		...preamble({
			global: [
				"    # normalize-uri is still marked experimental upstream.",
				"    expose-experimental-directives",
				"    tune.ssl.default-dh-param 2048"
			],
			defaults: ["    timeout client 30s", "    timeout server 30s"]
		}),
		...resolversSection(),
		...detectFrontend({
			listenPort: opts.listenPort,
			tlsStagePort: TLS_STAGE_PORT,
			plainStagePort: PLAIN_STAGE_PORT,
			ipRules,
			tlsHosts,
			proxyAddress: opts.proxyAddress,
			...shared
		}),
		...inspectStage({
			name: "https_in",
			port: TLS_STAGE_PORT,
			bindExtra: ` ssl crt ${opts.defaultCertFile} generate-certificates ca-sign-file ${opts.caSignFile}`,
			scheme: "https",
			rules: httpsRules,
			backend: "origin_tls"
		}, {
			mode,
			listenPort: opts.listenPort,
			...shared
		}),
		...inspectStage({
			name: "http_in",
			port: PLAIN_STAGE_PORT,
			bindExtra: "",
			scheme: "http",
			rules: httpRules,
			backend: "origin_plain"
		}, {
			mode,
			listenPort: opts.listenPort,
			...shared
		}),
		...originBackends(opts.systemCaFile)
	].join("\n");
}
//#endregion
//#region src/core/lib/acl/haproxy-universal-config.ts
const MATCH_ANYTHING = [{
	raw: null,
	regex: ".*"
}], LISTEN_PORT = 10024;
function hostPortRegex(rule) {
	return rule.hostMatch === "hostPort" ? rule.hostRegex : `${rule.hostRegex.slice(0, -1)}:${rule.port ?? "\\d+"}$`;
}
function aclLines(name, fetch, patterns) {
	return patterns.length === 0 ? [`    acl ${name} always_false`] : patterns.flatMap(({ raw, regex }) => [...raw === null ? [] : [`    # ${raw}`], `    acl ${name} ${fetch} -m reg -i ${escapeForHaproxy(regex)}`]);
}
function generateUniversalHaproxyConfig(options) {
	let audit = options.mode === "audit", toSelf = `!is_dns_routed is_ip_match ip_dst_internal { dst_port ${LISTEN_PORT} }`, https = MATCH_ANYTHING, http = MATCH_ANYTHING, ip = MATCH_ANYTHING;
	if (!audit) {
		[...options.httpsRules ?? [], ...options.httpRules ?? []].forEach(convertRule);
		let compiled = compileRuleSet(options);
		https = compiled.https.map((rule) => ({
			raw: rule.raw,
			regex: hostPortRegex(rule)
		})), http = compiled.http.map((rule) => ({
			raw: rule.raw,
			regex: hostPortRegex(rule)
		})), ip = compiled.ip.map((rule) => ({
			raw: rule.raw,
			regex: convertRule(rule.raw)
		}));
	}
	let decision = audit ? "AUDIT" : "ALLOWED", guard = {
		internalAddrs: [...INTERNAL_RANGES, PROXY_SUBNET],
		hostAddressFile: options.hostAddressFile
	};
	return [
		...preamble({
			global: ["    maxconn 2048"],
			defaults: [
				"    mode tcp",
				"    timeout client 1m",
				"    timeout server 1m"
			]
		}),
		...resolversSection(),
		"# --- Frontend ---",
		"frontend outbound_proxy",
		`    bind *:${LISTEN_PORT}`,
		"    tcp-request inspect-delay 5s",
		"",
		"    tcp-request content set-var(txn.decision) str(BLOCKED)",
		"    tcp-request content set-var(txn.reason) str(-)",
		"    tcp-request content set-var-fmt(txn.target) %[dst]:%[dst_port]",
		"    tcp-request content set-var(txn.rule_type) str(UNKNOWN)",
		"",
		`    acl is_dns_routed dst ${options.proxyAddress}`,
		"    tcp-request content set-var(txn.dns_routed) str(true) if is_dns_routed",
		"",
		"    acl is_tls req.ssl_hello_type 1",
		"    acl has_sni req_ssl_sni -m found",
		"",
		"    tcp-request content set-var-fmt(txn.dst_target) %[dst]:%[dst_port]",
		...aclLines("is_ip_match", "var(txn.dst_target)", ip),
		"",
		"    # ---------------------------------------------------------",
		"    # 1. IP direct access (non DNS-routed)",
		"    # ---------------------------------------------------------",
		"    tcp-request content set-var(txn.rule_type) str(IP) if !is_dns_routed",
		...internalDstAcl("ip_dst_internal", guard, "dst"),
		`    tcp-request content set-var(txn.reason) str(internal-address) if ${toSelf}`,
		`    tcp-request content reject if ${toSelf}`,
		`    tcp-request content set-var(txn.decision) str(${decision}) if !is_dns_routed is_ip_match`,
		"    tcp-request content accept if !is_dns_routed is_ip_match",
		"",
		...audit ? ["    tcp-request content accept if !is_dns_routed !is_ip_match"] : [],
		"    tcp-request content set-var(txn.reason) str(ip-not-allowed) if !is_dns_routed !is_ip_match",
		"    tcp-request content reject if !is_dns_routed !is_ip_match",
		"",
		"    tcp-request content set-var(txn.sni) req_ssl_sni if is_tls",
		"    tcp-request content set-var-fmt(txn.sni_port) %[var(txn.sni)]:%[dst_port] if is_tls",
		"    tcp-request content set-var(txn.sni_log) var(txn.sni),regsub([^A-Za-z0-9._-],_,g) if is_tls has_sni",
		"",
		...aclLines("is_https_allowed", "var(txn.sni_port)", https),
		`    acl sni_is_name var(txn.sni) -m reg ${HOSTNAME_CHARSET}`,
		"",
		"    tcp-request content set-var-fmt(txn.target) %[var(txn.sni_log)]:%[dst_port] if is_tls has_sni",
		"",
		"    # ---------------------------------------------------------",
		"    # 2. TLS without SNI",
		"    # ---------------------------------------------------------",
		"    tcp-request content set-var(txn.rule_type) str(HTTPS) if is_tls",
		"    tcp-request content set-var(txn.reason) str(missing-sni) if is_tls !has_sni",
		"    tcp-request content reject if is_tls !has_sni",
		"    tcp-request content set-var(txn.reason) str(invalid-sni) if is_tls has_sni !sni_is_name",
		"    tcp-request content reject if is_tls has_sni !sni_is_name",
		"",
		"    # ---------------------------------------------------------",
		"    # 3. TLS allowlist check (before DNS to avoid resolving blocked domains)",
		"    # ---------------------------------------------------------",
		"    tcp-request content set-var(txn.reason) str(not-allowed) if is_tls has_sni !is_https_allowed",
		"    tcp-request content reject if is_tls has_sni !is_https_allowed",
		"",
		"    # ---------------------------------------------------------",
		"    # 4. TLS DNS resolution, destination override & accept",
		"    # ---------------------------------------------------------",
		"    tcp-request content do-resolve(txn.dst,buildcage,ipv4) var(txn.sni) if is_tls has_sni",
		"    tcp-request content set-var(txn.reason) str(dns-failed) if is_tls has_sni ! { var(txn.dst) -m found }",
		"    tcp-request content reject if is_tls has_sni ! { var(txn.dst) -m found }",
		...internalDstAcl("dst_internal", guard),
		"    tcp-request content set-var(txn.reason) str(internal-address) if is_tls has_sni dst_internal",
		"    tcp-request content reject if is_tls has_sni dst_internal",
		"    tcp-request content set-dst var(txn.dst) if is_tls has_sni",
		`    tcp-request content set-var(txn.decision) str(${decision}) if is_tls has_sni`,
		"    tcp-request content accept if is_tls has_sni",
		"",
		"    # ---------------------------------------------------------",
		"    # 5. Non-TLS DNS-routed → HTTP frontend",
		"    # ---------------------------------------------------------",
		"    tcp-request content set-log-level silent if { var(txn.dns_routed) -m found } !is_tls",
		"    use_backend ip_passthrough if !{ var(txn.dns_routed) -m found }",
		"    use_backend tls_passthrough if is_tls",
		"    default_backend http_relay",
		"",
		"    log-format \"buildcage %[date(0,ms)] [%[var(txn.decision)]] (%[var(txn.rule_type)]) \\\"%[var(txn.target)]\\\" %[var(txn.reason)] %B\"",
		"",
		"# --- IP direct passthrough backend ---",
		"backend ip_passthrough",
		"    mode tcp",
		"    server cleartext 0.0.0.0:0",
		"",
		"# --- TLS passthrough backend ---",
		"backend tls_passthrough",
		"    mode tcp",
		"    server cleartext 0.0.0.0:0",
		"",
		"# --- HTTP frontend (L7) ---",
		"backend http_relay",
		"    mode tcp",
		"    server http_in 127.0.0.1:10026 send-proxy-v2",
		"",
		"frontend http_in",
		"    bind 127.0.0.1:10026 accept-proxy",
		"    mode http",
		"    timeout http-request 50s",
		"    timeout http-keep-alive 1m",
		"    http-request set-var(txn.decision) str(BLOCKED)",
		"    http-request set-var(txn.reason) str(-)",
		"    http-request set-var-fmt(txn.target) %[dst]:%[dst_port]",
		"    log-format \"buildcage %[date(0,ms)] [%[var(txn.decision)]] (HTTP) \\\"%[var(txn.target)]\\\" %[var(txn.reason)] %B ts=%ts dst=%[dst]:%[dst_port]\"",
		"    default_backend http_filter_backend",
		"",
		"backend http_filter_backend",
		"    mode http",
		"",
		"    acl has_host hdr(host) -m found",
		"    acl host_not_empty hdr_len(host) gt 0",
		"    http-request set-var(txn.reason) str(missing-host-header) if !has_host or !host_not_empty",
		"    http-request deny deny_status 400 content-type \"text/plain\" string \"Bad Request: Missing Host Header\" if !has_host or !host_not_empty",
		"",
		"    http-request set-var(txn.host_only) hdr(host),regsub(:.*$,),regsub(\\.$,)",
		"    http-request set-var-fmt(txn.host_port) %[var(txn.host_only)]:%[dst_port]",
		"",
		"    http-request set-var(txn.host_log) var(txn.host_only),regsub([^A-Za-z0-9._-],_,g)",
		"    http-request set-var-fmt(txn.target) %[var(txn.host_log)]:%[dst_port]",
		"",
		...aclLines("is_http_allowed", "var(txn.host_port)", http),
		"    http-request set-var(txn.reason) str(not-allowed) if !is_http_allowed",
		"    http-request deny deny_status 403 content-type \"text/plain\" string \"Blocked by egress proxy\" if !is_http_allowed",
		"",
		"    http-request do-resolve(txn.dst,buildcage,ipv4) var(txn.host_only)",
		"    http-request do-resolve(txn.dst,buildcage,ipv4) var(txn.host_only) unless { var(txn.dst) -m found }",
		"    http-request set-var(txn.reason) str(dns-failed) if ! { var(txn.dst) -m found }",
		"    http-request deny deny_status 503 content-type \"text/plain\" string \"DNS Resolution Failed\" if ! { var(txn.dst) -m found }",
		"",
		...internalDstAcl("dst_internal_http", guard),
		"    http-request set-var(txn.reason) str(internal-address) if dst_internal_http",
		"    http-request deny deny_status 403 content-type \"text/plain\" string \"Blocked by egress proxy\" if dst_internal_http",
		"",
		"    http-request set-dst var(txn.dst)",
		`    http-request set-var(txn.decision) str(${decision})`,
		"",
		"    server cleartext 0.0.0.0:0",
		""
	].join("\n");
}
//#endregion
//#region src/core/lib/acl/rules.ts
var InvalidRulesError = class extends ActionError {};
function parseRulesOrThrow(rulesInput) {
	try {
		return parseAndValidateRules(rulesInput);
	} catch (e) {
		throw new InvalidRulesError(errorMessage(e), "INVALID_RULES");
	}
}
function parseKnownBlockedRulesOrThrow(rulesInput) {
	try {
		return parseAndValidateKnownBlockedRules(rulesInput);
	} catch (e) {
		throw new InvalidRulesError(errorMessage(e), "INVALID_RULES");
	}
}
function buildUrlRulesOrThrow(rulesInput) {
	try {
		return buildUrlRules(rulesInput);
	} catch (e) {
		throw new InvalidRulesError(errorMessage(e), "INVALID_RULES");
	}
}
const PLACEHOLDER_PROXY_ADDRESS = "192.0.2.1";
function checkRulesCompileOrThrow(inputs) {
	try {
		generateHaproxyConfig({
			...inputs,
			proxyAddress: PLACEHOLDER_PROXY_ADDRESS
		}), generateUniversalHaproxyConfig({
			...inputs,
			proxyAddress: PLACEHOLDER_PROXY_ADDRESS,
			hostAddressFile: "/dev/null"
		}), generateCorednsConfig(compileRuleSet(inputs), { proxyAddress: PLACEHOLDER_PROXY_ADDRESS });
	} catch (e) {
		throw new InvalidRulesError(errorMessage(e), "INVALID_RULES");
	}
}
const IP_RULE_HOST = /^[0-9.*?/]+$/;
function parseIpRulesOrThrow(rulesInput) {
	let rules = parseRulesOrThrow(rulesInput);
	for (let rule of rules) {
		if (rule.startsWith("~")) continue;
		let host = rule.slice(0, rule.lastIndexOf(":"));
		if (!IP_RULE_HOST.test(host)) throw new InvalidRulesError(`IP rule "${rule}" names a host, not an address. allowed_ip_rules is matched against the address a connection goes to; allow a name with allowed_https_rules or allowed_http_rules instead.`, "INVALID_RULES");
		if (!isIpRuleAddress(host)) throw new InvalidRulesError(`IP rule "${rule}" is not an IPv4 address: write four octets, each a decimal from 0 to 255 without a leading zero (10.0.0.1, not 010.0.0.1) or a wildcard (10.0.*.*, or 10.** across dots), and a CIDR prefix from 0 to 32.`, "INVALID_RULES");
	}
	return rules;
}
function buildACLRules({ httpsRulesInput, httpRulesInput, ipRulesInput }) {
	return {
		httpsRules: parseRulesOrThrow(httpsRulesInput),
		httpRules: parseRulesOrThrow(httpRulesInput),
		ipRules: parseIpRulesOrThrow(ipRulesInput)
	};
}
//#endregion
//#region src/core/lib/actions/rule-inputs.ts
function readRuleInputs(getInput$3 = getInput) {
	let rules = buildACLRules({
		httpsRulesInput: getInput$3("allowed_https_rules"),
		httpRulesInput: getInput$3("allowed_http_rules"),
		ipRulesInput: getInput$3("allowed_ip_rules")
	}), knownBlockedRules = parseKnownBlockedRulesOrThrow(getInput$3("known_blocked_rules")), urlRulesInput = getInput$3("allowed_url_rules"), tlsRules = parseRulesOrThrow(getInput$3("allowed_tls_rules")), compiledUrlRules = buildUrlRulesOrThrow(urlRulesInput);
	checkRulesCompileOrThrow({
		...rules,
		tlsRules,
		urlRules: compiledUrlRules
	});
	let urlRules = compiledUrlRules.map((r) => r.raw);
	return {
		httpsRules: rules.httpsRules,
		httpRules: rules.httpRules,
		ipRules: rules.ipRules,
		urlRules,
		tlsRules,
		knownBlockedRules
	};
}
//#endregion
//#region src/lib/engine.ts
function resolveProxyEngine(input) {
	if (input?.trim() === "explicit") throw new InvalidInputError("proxy_engine: explicit has been removed. Use proxy_engine: universal (network-level SNI/Host inspection) or inspect (TLS-terminating URL enforcement).", "INVALID_PROXY_ENGINE");
	return resolveProxyEngine$1(input);
}
//#endregion
//#region src/lib/inputs.ts
function readBuilderName(getInput$2 = getInput) {
	return getInput$2("builder_name") || "buildcage";
}
function readSetupInputs(getInput$1 = getInput) {
	let proxyEngine = resolveProxyEngine(getInput$1("proxy_engine")), proxyMode = resolveProxyMode(getInput$1("proxy_mode")), failOnCaResidue = readBooleanInput("fail_on_ca_residue", !0, getInput$1);
	return {
		proxyEngine,
		builderName: readBuilderName(getInput$1),
		proxyMode,
		failOnCaResidue,
		...readRuleInputs(getInput$1)
	};
}
//#endregion
//#region src/lib/local-image.ts
async function readLocalImageOverride(env, log = console.log) {
	return null;
}
//#endregion
//#region src/lib/post-cleanup.ts
const __dirname$1 = (0, node_path.dirname)((0, node_url.fileURLToPath)(require("url").pathToFileURL(__filename).href)), COMPOSE_FILE = (0, node_path.join)(__dirname$1, "../docker/compose.action.yaml"), realDeps = {
	applyConfigFile,
	readSetupInputs,
	readLocalImageOverride,
	verifyImageDigestOrThrow,
	checkUrlAndTlsRuleSupport,
	checkKnownBlockedUrlRuleSupport,
	logRules,
	withLogGroup,
	builderStartError,
	runDocker: (args, env) => {
		(0, node_child_process.execFileSync)("docker", args, {
			stdio: "inherit",
			env
		});
	},
	saveState,
	log: console.log,
	warn: annotate.warning
};
async function resolveVerifiedImage({ actionRef, actionRepo, proxyEngine }, { verifyImageDigestOrThrow, log }) {
	let digest = await verifyImageDigestOrThrow({
		actionRef,
		actionRepo,
		proxyEngine
	});
	return log(`Image provenance verified for ref: ${JSON.stringify(actionRef)} (digest ${digest}).`), {
		imageRef: resolveBuildcageImageRef({
			imageDigest: digest,
			actionRepository: actionRepo
		}),
		pullPolicy: "always"
	};
}
async function runSetupStep(env, overrides = {}) {
	let { applyConfigFile, readSetupInputs, readLocalImageOverride, verifyImageDigestOrThrow, checkUrlAndTlsRuleSupport, checkKnownBlockedUrlRuleSupport, logRules, withLogGroup, builderStartError, runDocker, saveState, log, warn } = {
		...realDeps,
		...overrides
	}, actionRef = env.GITHUB_ACTION_REF ?? "", actionRepo = env.GITHUB_ACTION_REPOSITORY ?? "";
	for (let line of applyConfigFile(env, CONFIG_FILE_INPUTS)?.summary ?? []) log(line);
	let { proxyEngine, builderName, proxyMode, failOnCaResidue, httpsRules, httpRules, ipRules, urlRules, tlsRules, knownBlockedRules } = readSetupInputs();
	log(`Proxy engine: ${proxyEngine}`), env.GITHUB_STATE && saveState("builder_name", builderName), checkUrlAndTlsRuleSupport({
		proxyEngine,
		proxyMode,
		urlRules,
		tlsRules
	}, warn), checkKnownBlockedUrlRuleSupport({
		proxyEngine,
		proxyMode,
		knownBlockedUrlRules: knownBlockedRules.filter(isKnownBlockedUrlRule)
	}, warn), withLogGroup("buildcage: Configured ACL Rules", () => {
		logRules("HTTPS", httpsRules), logRules("HTTP", httpRules), logRules("IP", ipRules), logRules("URL", urlRules), logRules("TLS", tlsRules), logRules("Known blocked", knownBlockedRules);
	});
	let { imageRef, pullPolicy } = await readLocalImageOverride(env, log) ?? await resolveVerifiedImage({
		actionRef,
		actionRepo,
		proxyEngine
	}, {
		verifyImageDigestOrThrow,
		log
	});
	log(`buildcage: image: ${imageRef}`);
	let projectName = deriveProjectName(builderName), composeEnv = buildComposeEnv({
		builderName,
		proxyMode,
		proxyEngine,
		failOnCaResidue,
		imageRef,
		httpsRules,
		httpRules,
		ipRules,
		urlRules,
		tlsRules,
		knownBlockedRules
	}, env);
	try {
		runDocker(buildComposeDownArgs({
			composeFile: COMPOSE_FILE,
			projectName
		}), composeEnv);
	} catch (e) {
		throw new SetupError(describeDockerFailure(e, { operation: "docker compose down" }), "DOCKER_UNAVAILABLE");
	}
	try {
		runDocker(buildComposeUpArgs({
			composeFile: COMPOSE_FILE,
			projectName,
			pullPolicy
		}), composeEnv);
	} catch (e) {
		throw builderStartError(e, {
			composeFile: COMPOSE_FILE,
			projectName,
			builderName,
			composeEnv
		});
	}
}
//#endregion
//#region src/main.ts
process.argv[1] === (0, node_url.fileURLToPath)(require("url").pathToFileURL(__filename).href) && runSetupStep(process.env).catch(exitOnFatalError("setup"));
//#endregion

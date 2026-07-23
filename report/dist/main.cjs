let node_child_process = require("node:child_process"), node_fs = require("node:fs"), node_path = require("node:path"), node_url = require("node:url");
//#region core/lib/report/build-example.ts
const ruleTypeToParam = {
	HTTPS: "allowed_https_rules",
	HTTP: "allowed_http_rules",
	IP: "allowed_ip_rules"
};
/**
* Build a restrict-mode YAML configuration example from audited rows.
* Returns a markdown string wrapped in <details> tags, or "" if no rows.
*
* actionRef is the ref (tag or commit SHA) this action was invoked with.
*/
function buildRestrictExample(auditedRows, actionRepo, actionRef, { actionName = "setup", runCommand } = {}) {
	if (!auditedRows || auditedRows.length === 0) return "";
	let ref = /^[0-9a-f]{40}$/i.test(actionRef) ? "<sha>" : actionRef, groups = /* @__PURE__ */ new Map();
	for (let r of auditedRows) {
		let param = ruleTypeToParam[r.ruleType];
		param && (groups.has(param) || groups.set(param, []), groups.get(param).push(`${r.host}:${r.port}`));
	}
	if (groups.size === 0) return "";
	let yaml = "";
	if (yaml += "- name: Start Buildcage in restrict mode\n", yaml += `  uses: ${actionRepo}/${actionName}@${ref}\n`, yaml += "  with:\n", actionName === "run" && runCommand) {
		yaml += "    run: |\n";
		for (let line of runCommand.replace(/\r?\n$/, "").split(/\r?\n/)) yaml += `      ${line}\n`;
	}
	yaml += "    proxy_mode: restrict\n";
	for (let [param, rules] of groups) {
		yaml += `    ${param}: >-\n`;
		for (let rule of rules) yaml += `      ${rule}\n`;
	}
	let md = "\n<details>\n";
	return md += "<summary>🛡️ Switch to restrict mode</summary>\n\n", md += "```yaml\n", md += yaml, md += "```\n\n", md += "</details>\n", md;
}
//#endregion
//#region report/src/lib/command-log.ts
/**
* Render the explicit engine's communication detail as a collapsed markdown
* section, or "" if there's nothing to show. Allowed Urls is listed before
* Blocked Urls, matching the Allowed Hosts / Blocked Hosts tables above.
*
* Blocked entries aren't attributed to a specific RUN step — buildkitd's
* denial log carries no vertex/span identifier to attribute it with. A
* "Build N" item separates builds only when there's more than one, since
* step labels like "[2/15] RUN ..." repeat across builds.
*
* Command text is escaped since it's embedded directly in markdown; request
* lines go inside a fenced code block instead, where escaping isn't needed.
*/
function renderCommunicationDetails(builds, deniedTimeline) {
	let nonEmptyBuilds = (builds || []).filter((b) => b && b.length > 0), hasVertexLog = nonEmptyBuilds.length > 0, hasDenied = deniedTimeline && deniedTimeline.length > 0;
	if (!hasVertexLog && !hasDenied) return "";
	let md = "\n<details>\n<summary>💬 Communication details</summary>\n\n";
	if (hasVertexLog) {
		md += "* **✅ Allowed Urls**\n\n";
		let showBuildHeadings = nonEmptyBuilds.length > 1;
		nonEmptyBuilds.forEach((vertices, i) => {
			let indent = showBuildHeadings ? "      " : "   ";
			showBuildHeadings && (md += `   * Build ${i + 1}\n\n`);
			for (let vertex of vertices) md += renderVertexItem(vertex, indent);
		});
	}
	if (hasDenied) {
		md += "* **🚫 Blocked Urls**\n\n";
		for (let { url, timestamp } of deniedTimeline) md += `   - (${formatSeconds(timestamp)}) ${escapeMarkdown(url)}\n`;
		md += "\n";
	}
	return md += "</details>\n", md;
}
function renderVertexItem({ command, started, completed, entries }, indent) {
	let inner = indent + "   ", s = `${indent}* ${escapeMarkdown(command)}\n\n`;
	if (s += `${inner}(${formatSeconds(started)} · duration ${formatDuration(started, completed)})\n\n`, s += `${inner}\`\`\`\n`, entries.length === 0) s += `${inner}(no communication)\n`;
	else for (let entry of entries) s += `${inner}${renderRequestLine(entry)}\n`;
	return s += `${inner}\`\`\`\n\n`, s;
}
function renderRequestLine({ method, url, status }) {
	let line = `- ${escapeMarkdown(method)} ${escapeMarkdown(url)}`;
	return status === void 0 ? line : `${line} -> ${status}`;
}
function escapeMarkdown(text) {
	return text.replace(/([\\`*_[\]<>])/g, "\\$1");
}
function formatSeconds(iso) {
	return new Date(iso).toISOString().slice(11, 19) + "Z";
}
function formatDuration(started, completed) {
	return `${((Date.parse(completed) - Date.parse(started)) / 1e3).toFixed(3)}s`;
}
//#endregion
//#region core/shared/lib/parse-identifier.js
const DEFAULT_PORT = {
	https: "443",
	http: "80"
};
/**
* Parse a proxy-network source identifier ("https://host[:port]/path...")
* into its scheme/host/port. BuildKit omits an explicit ":443"/":80" from the
* identifier when the original request didn't specify a port, so a missing
* port is filled in with the scheme's default. Returns null for non-http(s)
* identifiers — buildcage's generated policy only ever denies ^https?://
* sources, but this guards against unexpected input.
*/
function parseIdentifier(identifier) {
	let m = identifier.match(/^(https?):\/\/([^/]+)/);
	if (!m) return null;
	let [, scheme, hostPort] = m, colonIdx = hostPort.lastIndexOf(":");
	return colonIdx > 0 ? {
		scheme,
		host: hostPort.substring(0, colonIdx),
		port: hostPort.substring(colonIdx + 1)
	} : {
		scheme,
		host: hostPort,
		port: DEFAULT_PORT[scheme]
	};
}
//#endregion
//#region core/shared/lib/aggregate.js
/**
* Aggregate log entries by (host, port, ruleType, reason) with counts, sorted
* descending.
*
* @param {{ host: string, port: string, ruleType: string, reason: string }[]} filtered
* @returns {{ host: string, port: string, ruleType: string, reason: string, count: number }[]}
*/
function aggregate(filtered) {
	let map = {};
	for (let e of filtered) {
		let key = `${e.host}\t${e.port}\t${e.ruleType}\t${e.reason}`;
		map[key] = (map[key] || 0) + 1;
	}
	return Object.keys(map).map((key) => {
		let [host, portStr, ruleType, reason] = key.split("	");
		return {
			host,
			port: portStr,
			ruleType,
			reason,
			count: map[key]
		};
	}).sort((a, b) => b.count - a.count || (a.host < b.host ? -1 : +(a.host > b.host)) || Number(a.port) - Number(b.port));
}
//#endregion
//#region report/src/lib/vertex-log.ts
function selectAllRefs(historiesText) {
	let byRef = /* @__PURE__ */ new Map();
	for (let line of historiesText.split("\n")) {
		if (!line.trim()) continue;
		let event;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		let record = event.record, createdAt = record?.CreatedAt;
		!record?.Ref || !createdAt || byRef.set(record.Ref, createdAt);
	}
	return [...byRef.entries()].sort((a, b) => compareCreatedAt(a[1], b[1])).map(([ref]) => ref);
}
function compareCreatedAt(a, b) {
	return a.seconds === b.seconds ? (a.nanos || 0) - (b.nanos || 0) : a.seconds - b.seconds;
}
const runVertexPattern = /^\[([^\]]+)\]\s+RUN\s/;
function stageKeyOf(bracketContent) {
	let parts = bracketContent.trim().split(/\s+/);
	return parts.length > 1 ? parts[0] : "";
}
const requestLineDetailPattern = /^-\s+(\S+)\s+(\S+?)(?:\s+->\s+(\d+))?$/;
function parseAllowedRequestsFromText(text) {
	let entries = [], lines = text.split("\n");
	for (let i = 0; i < lines.length; i++) if (lines[i].trim() === "proxy network requests:") for (let j = i + 1; j < lines.length; j++) {
		let m = lines[j].match(requestLineDetailPattern);
		if (!m) break;
		let [, method, url, status] = m;
		entries.push(status === void 0 ? {
			method,
			url
		} : {
			method,
			url,
			status: Number(status)
		});
	}
	return entries;
}
function parseVertexAllowedLog(rawJsonText) {
	let vertexes = [], logs = [];
	for (let line of rawJsonText.split("\n")) {
		if (!line.trim()) continue;
		let data;
		try {
			data = JSON.parse(line);
		} catch {
			continue;
		}
		vertexes.push(...data.vertexes || []), logs.push(...data.logs || []);
	}
	let groups = /* @__PURE__ */ new Map();
	for (let v of vertexes) {
		if (!v.started || !v.completed) continue;
		let m = v.name.match(runVertexPattern);
		if (!m) continue;
		let stageKey = stageKeyOf(m[1]);
		groups.has(stageKey) || groups.set(stageKey, []), groups.get(stageKey).push(v);
	}
	for (let list of groups.values()) list.sort((a, b) => Date.parse(a.started) - Date.parse(b.started));
	let orderedGroups = [...groups.values()].sort((a, b) => Date.parse(a[0].started) - Date.parse(b[0].started)), logsByDigest = /* @__PURE__ */ new Map();
	for (let l of logs) l.stream === 2 && (logsByDigest.has(l.vertex) || logsByDigest.set(l.vertex, []), logsByDigest.get(l.vertex).push(l));
	return orderedGroups.flat().map((v) => {
		let text = (logsByDigest.get(v.digest) || []).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)).map((l) => Buffer.from(l.data, "base64").toString("utf8")).join("");
		return {
			command: v.name,
			started: v.started,
			completed: v.completed,
			entries: parseAllowedRequestsFromText(text)
		};
	});
}
function aggregateAllowedHosts(builds, decision) {
	let entries = [];
	for (let vertices of builds) for (let { entries: vertexEntries } of vertices) for (let { url } of vertexEntries) {
		let parsed = parseIdentifier(url);
		parsed && entries.push({
			decision,
			ruleType: parsed.scheme === "https" ? "HTTPS" : "HTTP",
			host: parsed.host,
			port: parsed.port,
			reason: "-"
		});
	}
	return aggregate(entries);
}
//#endregion
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
//#endregion
//#region core/shared/lib/rules.js
/**
* Rule conversion library for buildcage container.
* Converts wildcard patterns to regex strings for HAProxy ACLs.
*/
/**
* Split a whitespace-separated rules string into individual rule tokens.
*
* @param {string|undefined} rulesInput
* @returns {string[]}
*/
function splitRuleTokens(rulesInput) {
	return rulesInput?.trim().split(/\s+/).filter(Boolean) ?? [];
}
/**
* Split+validate a space-separated rules string, returning the raw
* (unconverted) rule tokens — for callers that need the original
* wildcard/~regex syntax preserved, such as known_blocked_rules.
*
* @param {string|undefined} rulesInput
* @returns {string[]}
* @throws {Error} if any rule has invalid wildcard/regex syntax
*/
function parseAndValidateRules(rulesInput) {
	let rules = splitRuleTokens(rulesInput);
	return rules.forEach(convertRule), rules;
}
/**
* Convert a single rule (wildcard or `~`-prefixed regex) to a regex string.
*/
function convertRule(rule) {
	if (rule.startsWith("~")) {
		let regex = rule.slice(1);
		try {
			new RegExp(regex);
		} catch (e) {
			throw Error(`Invalid regex in rule "${rule}": ${e.message}`);
		}
		return regex;
	}
	return `^${wildcardToRegex(rule)}$`;
}
/**
* Convert a domain wildcard to a regex string (without anchors or port).
*
* Supported wildcards:
*   `**` — matches one or more characters including dots
*   `*`  — matches one or more characters excluding dots
*   `?`  — matches a single character excluding dots
*
* A dot-separated part containing `*` must be exactly `*` or `**`.
*/
function domainToRegex(domain) {
	return domain.split(".").map((part) => {
		if (part === "**") return ".+";
		if (part === "*") return "[^.]+";
		if (part.includes("*")) throw Error(`Invalid wildcard in "${domain}": part "${part}" mixes "*" with other characters`);
		return part.replace(/[.+^$()[\]{}|\\]/g, "\\$&").replace(/\?/g, "[^.]");
	}).join("\\.");
}
/**
* Convert a wildcard pattern (`<domain>:<port|*>`) to a regex string (without anchors).
*/
function wildcardToRegex(pattern) {
	if (!/^[^:]+:(?:\d+|\*)$/.test(pattern)) throw Error(`Invalid pattern "${pattern}"`);
	let [domain, port] = pattern.split(":"), portRegex = port === "*" ? "\\d+" : port;
	return `${domainToRegex(domain)}:${portRegex}`;
}
//#endregion
//#region core/lib/report/known-blocked.ts
/**
* Shared logic for `known_blocked_rules`: domains expected to be blocked,
* so a matching blocked connection doesn't fail the step even when
* fail_on_blocked is true. Never sent to the container's ACL — only
* affects this action's pass/fail decision and Job Summary rendering.
*/
/**
* Tag each aggregated blocked-hosts row with `expected: boolean` — true iff
* its `host:port` matches at least one known_blocked_rules pattern.
*
* knownBlockedRules is as returned by parseAndValidateRules.
*/
function annotateKnownBlocked(blockedRows, knownBlockedRules) {
	let matchers = knownBlockedRules.map((rule) => new RegExp(convertRule(rule)));
	return blockedRows.map((row) => ({
		...row,
		expected: matchers.some((re) => re.test(`${row.host}:${row.port}`))
	}));
}
function determineBlockedOutcome({ isAudit, failOnBlocked, blockedCount, blockedRows }) {
	if (!blockedCount) return {
		level: "none",
		shouldFail: !1
	};
	if (isAudit) return {
		level: "notice",
		shouldFail: !1
	};
	let hasUnexpected = blockedRows.length === 0 || blockedRows.some((row) => !row.expected);
	return failOnBlocked && hasUnexpected ? {
		level: "error",
		shouldFail: !0
	} : {
		level: "notice",
		shouldFail: !1
	};
}
function buildBlockedMessage({ blockedCount, blockedRows, engineLabel, isAudit }) {
	let base = `${blockedCount} blocked connection(s) detected by buildcage ${engineLabel}`;
	if (isAudit) return base;
	let unexpected = blockedRows.filter((row) => !row.expected).length;
	return unexpected === blockedRows.length ? base : unexpected === 0 ? `${base}, all matched known_blocked_rules (expected)` : `${base} (${unexpected} of ${blockedRows.length} distinct blocked host(s) unmatched by known_blocked_rules)`;
}
function evaluateBlockedReport(report, { knownBlockedRules, failOnBlocked, engineLabel }) {
	let isAudit = report.mode === "audit", blockedRows = annotateKnownBlocked(report.sections?.blocked ?? [], knownBlockedRules), outcome = determineBlockedOutcome({
		isAudit,
		failOnBlocked,
		blockedCount: report.blockedCount ?? 0,
		blockedRows
	}), message = buildBlockedMessage({
		blockedCount: report.blockedCount ?? 0,
		blockedRows,
		engineLabel,
		isAudit
	});
	return {
		blockedRows,
		showExpected: knownBlockedRules.length > 0,
		outcome,
		message
	};
}
//#endregion
//#region core/lib/actions/markdown-table.ts
const ALIGN_MARKERS = {
	left: "---",
	right: "---:",
	center: ":---:"
}, alignMarker = (align) => ALIGN_MARKERS[align ?? "left"] ?? ALIGN_MARKERS.left;
/**
* Render a generic GitHub-flavored markdown table.
*/
function markdownTable(formats, rows) {
	let headers = formats.map((f) => f.title), aligns = formats.map((f) => alignMarker(f.align)), lines = [`| ${headers.join(" | ")} |`, `| ${aligns.join(" | ")} |`];
	for (let row of rows) {
		let cells = formats.map((f) => row[f.key]);
		lines.push(`| ${cells.join(" | ")} |`);
	}
	return lines.join("\n");
}
//#endregion
//#region core/lib/report/host-table.ts
/**
* Render aggregated host rows as a GitHub-flavored markdown table.
*/
function renderHostTable(rows, { showReason = !1, showExpected = !1 } = {}) {
	let formats = [{
		key: "host",
		title: "Host"
	}, {
		key: "ruleType",
		title: "Rule"
	}];
	return showReason && formats.push({
		key: "reason",
		title: "Reason"
	}), formats.push({
		key: "count",
		title: "Count",
		align: "right"
	}), showExpected && formats.push({
		key: "expected",
		title: "Expected",
		align: "center"
	}), markdownTable(formats, rows.map((r) => ({
		host: `${r.host}:${r.port}`,
		ruleType: r.ruleType,
		reason: r.reason,
		count: r.count,
		expected: r.expected ? "✅" : ""
	})));
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
//#region core/lib/acl/rules.ts
/**
* Thrown when an ACL rule input (allowed_https_rules/allowed_http_rules/
* allowed_ip_rules/known_blocked_rules) fails to parse — shared by the
* setup and run actions, which both accept the same rule syntax.
*/
var InvalidRulesError = class extends ActionError {};
/**
* Rethrow a rule-parser's syntax errors as an InvalidRulesError.
*/
function parseRulesOrThrow(rulesInput) {
	try {
		return parseAndValidateRules(rulesInput);
	} catch (e) {
		throw new InvalidRulesError(errorMessage(e), "INVALID_RULES");
	}
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
//#region report/src/main.ts
const __dirname$1 = (0, node_path.dirname)((0, node_url.fileURLToPath)(require("url").pathToFileURL(__filename).href)), composeFile = process.argv[2] || (0, node_path.join)(__dirname$1, "../..", "setup", "compose.yaml"), composeEnv = {
	...process.env,
	BUILDER_NAME: process.env.INPUT_BUILDER_NAME || "buildcage"
}, summaryFile = process.env.GITHUB_STEP_SUMMARY, annotation = createAnnotation(!!summaryFile);
let knownBlockedRules;
try {
	knownBlockedRules = parseRulesOrThrow(process.env.INPUT_KNOWN_BLOCKED_RULES);
} catch (e) {
	annotation.error(errorMessage(e)), process.exit(1);
}
let jsonOutput;
try {
	jsonOutput = (0, node_child_process.execFileSync)("docker", [
		"compose",
		"-f",
		composeFile,
		"exec",
		"builder",
		"sh",
		"-c",
		"qjs -m /opt/buildcage/scripts/report.js"
	], {
		encoding: "utf8",
		stdio: [
			"ignore",
			"pipe",
			"pipe"
		],
		env: composeEnv
	});
} catch (e) {
	annotation.error(describeDockerFailure(e, { operation: "fetching the sandbox report from the container" })), process.exit(1);
}
const report = JSON.parse(jsonOutput);
console.log("::group::HTTP Proxy communication logs");
try {
	let rawLog = (0, node_child_process.execFileSync)("docker", [
		"compose",
		"-f",
		composeFile,
		"exec",
		"builder",
		"sh",
		"-c",
		"cat /var/log/buildkitd/current 2>/dev/null || cat /var/log/haproxy/current 2>/dev/null"
	], {
		encoding: "utf8",
		stdio: [
			"ignore",
			"pipe",
			"pipe"
		],
		env: composeEnv
	});
	process.stdout.write(rawLog);
} catch {
	console.log("(failed to read raw log)");
}
console.log("::endgroup::"), console.log(), report.mode === null && (summaryFile && (0, node_fs.appendFileSync)(summaryFile, "No proxy logs found.\n"), console.log("No proxy logs found."), process.exit(0));
const actionRepo = process.env.GITHUB_ACTION_REPOSITORY || "dash14/buildcage", actionRef = process.env.GITHUB_ACTION_REF || "v2", isAudit = report.mode === "audit", isExplicit = report.deniedTimeline !== void 0;
let builds = [];
if (isExplicit) try {
	builds = selectAllRefs((0, node_child_process.execFileSync)("docker", [
		"compose",
		"-f",
		composeFile,
		"exec",
		"builder",
		"buildctl",
		"debug",
		"histories",
		"--format",
		"{{json .}}"
	], {
		encoding: "utf8",
		stdio: [
			"ignore",
			"pipe",
			"pipe"
		],
		env: composeEnv
	})).map((ref) => parseVertexAllowedLog((0, node_child_process.execFileSync)("docker", [
		"compose",
		"-f",
		composeFile,
		"exec",
		"builder",
		"buildctl",
		"debug",
		"logs",
		"--progress=rawjson",
		ref
	], {
		encoding: "utf8",
		stdio: [
			"ignore",
			"pipe",
			"pipe"
		],
		env: composeEnv,
		maxBuffer: 64 * 1024 * 1024
	})));
} catch (e) {
	console.log("(failed to fetch allowed/audited traffic detail via buildctl:", errorMessage(e), ")");
}
const failOnBlocked = (process.env.INPUT_FAIL_ON_BLOCKED || "true").toLowerCase() === "true", { blockedRows: annotatedBlocked, showExpected, outcome, message } = evaluateBlockedReport(report, {
	knownBlockedRules,
	failOnBlocked,
	engineLabel: "proxy"
});
let markdown = `## Outbound Traffic Report during Docker Build (${report.mode} mode)\n\n`;
if (isAudit) {
	let audited = isExplicit ? aggregateAllowedHosts(builds, "AUDIT") : report.sections?.audited || [];
	audited.length > 0 && (markdown += "### 📋 Audited Hosts\n\n" + renderHostTable(audited) + "\n"), markdown += buildRestrictExample(audited, actionRepo, actionRef), annotatedBlocked.length > 0 && (audited.length > 0 && (markdown += "\n"), markdown += "### 🚫 Blocked Hosts\n\n" + renderHostTable(annotatedBlocked, {
		showReason: !0,
		showExpected
	}) + "\n");
} else {
	let allowed = isExplicit ? aggregateAllowedHosts(builds, "ALLOWED") : report.sections?.allowed || [];
	allowed.length > 0 && (markdown += "### ✅ Allowed Hosts\n\n" + renderHostTable(allowed) + "\n"), allowed.length > 0 && annotatedBlocked.length > 0 && (markdown += "\n"), annotatedBlocked.length > 0 && (markdown += "### 🚫 Blocked Hosts\n\n" + renderHostTable(annotatedBlocked, {
		showReason: !0,
		showExpected
	}) + "\n");
}
isExplicit && (markdown += renderCommunicationDetails(builds, report.deniedTimeline)), isExplicit || (markdown += "\n<sub>*Note: HTTP rules are based on the Host header, HTTPS rules on SNI, and IP rules on the destination IP address.*</sub>\n"), markdown += `\n*Reported by [Buildcage](https://github.com/${actionRepo})*\n`, summaryFile ? (0, node_fs.appendFileSync)(summaryFile, markdown) : console.log(markdown), outcome.level === "error" ? (annotation.error(message), process.exitCode = 1) : outcome.level === "notice" && annotation.notice(message);
//#endregion

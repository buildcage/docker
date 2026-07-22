"use strict";

var node_child_process = require("node:child_process"), node_fs = require("node:fs"), node_path = require("node:path"), node_url = require("node:url"), _documentCurrentScript = "undefined" != typeof document ? document.currentScript : null;

const ruleTypeToParam = {
  HTTPS: "allowed_https_rules",
  HTTP: "allowed_http_rules",
  IP: "allowed_ip_rules"
};

function renderVertexItem({command: command, started: started, completed: completed, entries: entries}, indent) {
  const inner = indent + "   ";
  let s = `${indent}* ${escapeMarkdown(command)}\n\n`;
  if (s += `${inner}(${formatSeconds(started)} · duration ${function(started, completed) {
    const seconds = (Date.parse(completed) - Date.parse(started)) / 1e3;
    return `${seconds.toFixed(3)}s`;
  }(started, completed)})\n\n`, s += `${inner}\`\`\`\n`, 0 === entries.length) s += `${inner}(no communication)\n`; else for (const entry of entries) s += `${inner}${renderRequestLine(entry)}\n`;
  return s += `${inner}\`\`\`\n\n`, s;
}

function renderRequestLine({method: method, url: url, status: status}) {
  const line = `- ${escapeMarkdown(method)} ${escapeMarkdown(url)}`;
  return void 0 === status ? line : `${line} -> ${status}`;
}

function escapeMarkdown(text) {
  return text.replace(/([\\`*_[\]<>])/g, "\\$1");
}

function formatSeconds(iso) {
  return new Date(iso).toISOString().slice(11, 19) + "Z";
}

const DEFAULT_PORT = {
  https: "443",
  http: "80"
};

function parseIdentifier(identifier) {
  const m = identifier.match(/^(https?):\/\/([^/]+)/);
  if (!m) return null;
  const [, scheme, hostPort] = m, colonIdx = hostPort.lastIndexOf(":");
  return colonIdx > 0 ? {
    scheme: scheme,
    host: hostPort.substring(0, colonIdx),
    port: hostPort.substring(colonIdx + 1)
  } : {
    scheme: scheme,
    host: hostPort,
    port: DEFAULT_PORT[scheme]
  };
}

const runVertexPattern = /^\[([^\]]+)\]\s+RUN\s/;

function stageKeyOf(bracketContent) {
  const parts = bracketContent.trim().split(/\s+/);
  return parts.length > 1 ? parts[0] : "";
}

const requestLineDetailPattern = /^-\s+(\S+)\s+(\S+?)(?:\s+->\s+(\d+))?$/;

function parseAllowedRequestsFromText(text) {
  const entries = [], lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) if ("proxy network requests:" === lines[i].trim()) for (let j = i + 1; j < lines.length; j++) {
    const m = lines[j].match(requestLineDetailPattern);
    if (!m) break;
    const [, method, url, status] = m;
    entries.push(void 0 === status ? {
      method: method,
      url: url
    } : {
      method: method,
      url: url,
      status: Number(status)
    });
  }
  return entries;
}

function aggregateAllowedHosts(builds, decision) {
  const entries = [];
  for (const vertices of builds) for (const {entries: vertexEntries} of vertices) for (const {url: url} of vertexEntries) {
    const parsed = parseIdentifier(url);
    parsed && entries.push({
      decision: decision,
      ruleType: "https" === parsed.scheme ? "HTTPS" : "HTTP",
      host: parsed.host,
      port: parsed.port,
      reason: "-"
    });
  }
  return function(filtered) {
    const map = {};
    for (const e of filtered) {
      const key = `${e.host}\t${e.port}\t${e.ruleType}\t${e.reason}`;
      map[key] = (map[key] || 0) + 1;
    }
    return Object.keys(map).map(key => {
      const [host, portStr, ruleType, reason] = key.split("\t");
      return {
        host: host,
        port: portStr,
        ruleType: ruleType,
        reason: reason,
        count: map[key]
      };
    }).sort((a, b) => b.count - a.count || (a.host < b.host ? -1 : a.host > b.host ? 1 : 0) || Number(a.port) - Number(b.port));
  }(entries);
}

function convertRule(rule) {
  if (rule.startsWith("~")) {
    const regex = rule.slice(1);
    try {
      new RegExp(regex);
    } catch (e) {
      throw new Error(`Invalid regex in rule "${rule}": ${e.message}`);
    }
    return regex;
  }
  return `^${function(pattern) {
    if (!/^[^:]+:(?:\d+|\*)$/.test(pattern)) throw new Error(`Invalid pattern "${pattern}"`);
    const [domain, port] = pattern.split(":"), portRegex = "*" === port ? "\\d+" : port;
    return `${function(domain) {
      const regexParts = domain.split(".").map(part => {
        if ("**" === part) return ".+";
        if ("*" === part) return "[^.]+";
        if (part.includes("*")) throw new Error(`Invalid wildcard in "${domain}": part "${part}" mixes "*" with other characters`);
        return part.replace(/[.+^$()[\]{}|\\]/g, "\\$&").replace(/\?/g, "[^.]");
      });
      return regexParts.join("\\.");
    }(domain)}:${portRegex}`;
  }(rule)}$`;
}

const ALIGN_MARKERS = {
  left: "---",
  right: "---:",
  center: ":---:"
};

function markdownTable(formats, rows) {
  const headers = formats.map(f => f.title), aligns = formats.map(f => {
    return align = f.align, ALIGN_MARKERS[align] ?? ALIGN_MARKERS.left;
    var align;
  }), lines = [ `| ${headers.join(" | ")} |`, `| ${aligns.join(" | ")} |` ];
  for (const row of rows) {
    const cells = formats.map(f => row[f.key]);
    lines.push(`| ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}

function renderHostTable(rows, {showReason: showReason = !1, showExpected: showExpected = !1} = {}) {
  const formats = [ {
    key: "host",
    title: "Host"
  }, {
    key: "ruleType",
    title: "Rule"
  } ];
  showReason && formats.push({
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
  });
  return markdownTable(formats, rows.map(r => ({
    host: `${r.host}:${r.port}`,
    ruleType: r.ruleType,
    reason: r.reason,
    count: r.count,
    expected: r.expected ? "✅" : ""
  })));
}

const __dirname$1 = node_path.dirname(node_url.fileURLToPath("undefined" == typeof document ? require("url").pathToFileURL(__filename).href : _documentCurrentScript && "SCRIPT" === _documentCurrentScript.tagName.toUpperCase() && _documentCurrentScript.src || new URL("main.cjs", document.baseURI).href)), composeFile = process.argv[2] || node_path.join(__dirname$1, "../..", "setup", "compose.yaml"), composeEnv = {
  ...process.env,
  BUILDER_NAME: process.env.INPUT_BUILDER_NAME || "buildcage"
};

let knownBlockedRules, jsonOutput;

try {
  knownBlockedRules = function(rulesInput) {
    const rules = function(rulesInput) {
      return rulesInput?.trim().split(/\s+/).filter(Boolean) ?? [];
    }(rulesInput);
    return rules.forEach(convertRule), rules;
  }(process.env.INPUT_KNOWN_BLOCKED_RULES);
} catch (e) {
  console.log(`::error::${e.message}`), process.exit(1);
}

try {
  jsonOutput = node_child_process.execFileSync("docker", [ "compose", "-f", composeFile, "exec", "builder", "sh", "-c", "qjs -m /opt/buildcage/scripts/report.js" ], {
    encoding: "utf8",
    stdio: [ "ignore", "pipe", "pipe" ],
    env: composeEnv
  });
} catch (e) {
  console.log("Failed to get report from container:", e.message), process.exit(1);
}

const report = JSON.parse(jsonOutput);

console.log("::group::HTTP Proxy communication logs");

try {
  const rawLog = node_child_process.execFileSync("docker", [ "compose", "-f", composeFile, "exec", "builder", "sh", "-c", "cat /var/log/buildkitd/current 2>/dev/null || cat /var/log/haproxy/current 2>/dev/null" ], {
    encoding: "utf8",
    stdio: [ "ignore", "pipe", "pipe" ],
    env: composeEnv
  });
  process.stdout.write(rawLog);
} catch {
  console.log("(failed to read raw log)");
}

if (console.log("::endgroup::"), console.log(), null === report.mode) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  summaryFile && node_fs.appendFileSync(summaryFile, "No proxy logs found.\n"), console.log("No proxy logs found."), 
  process.exit(0);
}

const actionRepo = process.env.GITHUB_ACTION_REPOSITORY || "dash14/buildcage", actionRef = process.env.GITHUB_ACTION_REF || "v2", isAudit = "audit" === report.mode, isExplicit = void 0 !== report.deniedTimeline;

let builds = [];

if (isExplicit) try {
  const historiesOutput = node_child_process.execFileSync("docker", [ "compose", "-f", composeFile, "exec", "builder", "buildctl", "debug", "histories", "--format", "{{json .}}" ], {
    encoding: "utf8",
    stdio: [ "ignore", "pipe", "pipe" ],
    env: composeEnv
  });
  builds = function(historiesText) {
    const byRef = new Map;
    for (const line of historiesText.split("\n")) {
      if (!line.trim()) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      const record = event.record, createdAt = record?.CreatedAt;
      record?.Ref && createdAt && byRef.set(record.Ref, createdAt);
    }
    return [ ...byRef.entries() ].sort((a, b) => function(a, b) {
      return a.seconds !== b.seconds ? a.seconds - b.seconds : (a.nanos || 0) - (b.nanos || 0);
    }(a[1], b[1])).map(([ref]) => ref);
  }(historiesOutput).map(ref => function(rawJsonText) {
    const vertexes = [], logs = [];
    for (const line of rawJsonText.split("\n")) {
      if (!line.trim()) continue;
      let data;
      try {
        data = JSON.parse(line);
      } catch {
        continue;
      }
      vertexes.push(...data.vertexes || []), logs.push(...data.logs || []);
    }
    const groups = new Map;
    for (const v of vertexes) {
      if (!v.started || !v.completed) continue;
      const m = v.name.match(runVertexPattern);
      if (!m) continue;
      const stageKey = stageKeyOf(m[1]);
      groups.has(stageKey) || groups.set(stageKey, []), groups.get(stageKey).push(v);
    }
    for (const list of groups.values()) list.sort((a, b) => Date.parse(a.started) - Date.parse(b.started));
    const orderedGroups = [ ...groups.values() ].sort((a, b) => Date.parse(a[0].started) - Date.parse(b[0].started)), logsByDigest = new Map;
    for (const l of logs) 2 === l.stream && (logsByDigest.has(l.vertex) || logsByDigest.set(l.vertex, []), 
    logsByDigest.get(l.vertex).push(l));
    return orderedGroups.flat().map(v => {
      const text = (logsByDigest.get(v.digest) || []).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)).map(l => Buffer.from(l.data, "base64").toString("utf8")).join("");
      return {
        command: v.name,
        started: v.started,
        completed: v.completed,
        entries: parseAllowedRequestsFromText(text)
      };
    });
  }(node_child_process.execFileSync("docker", [ "compose", "-f", composeFile, "exec", "builder", "buildctl", "debug", "logs", "--progress=rawjson", ref ], {
    encoding: "utf8",
    stdio: [ "ignore", "pipe", "pipe" ],
    env: composeEnv,
    maxBuffer: 67108864
  })));
} catch (e) {
  console.log("(failed to fetch allowed/audited traffic detail via buildctl:", e.message, ")");
}

const failOnBlocked = "true" === (process.env.INPUT_FAIL_ON_BLOCKED || "true").toLowerCase(), {blockedRows: annotatedBlocked, showExpected: showExpected, outcome: outcome, message: message} = function(report, {knownBlockedRules: knownBlockedRules, failOnBlocked: failOnBlocked, engineLabel: engineLabel}) {
  const isAudit = "audit" === report.mode, blockedRows = function(blockedRows, knownBlockedRules) {
    const matchers = knownBlockedRules.map(rule => new RegExp(convertRule(rule)));
    return blockedRows.map(row => ({
      ...row,
      expected: matchers.some(re => re.test(`${row.host}:${row.port}`))
    }));
  }(report.sections?.blocked ?? [], knownBlockedRules), outcome = function({isAudit: isAudit, failOnBlocked: failOnBlocked, blockedCount: blockedCount, blockedRows: blockedRows}) {
    if (!blockedCount) return {
      level: "none",
      shouldFail: !1
    };
    if (isAudit) return {
      level: "notice",
      shouldFail: !1
    };
    const hasUnexpected = 0 === blockedRows.length || blockedRows.some(row => !row.expected);
    return failOnBlocked && hasUnexpected ? {
      level: "error",
      shouldFail: !0
    } : {
      level: "notice",
      shouldFail: !1
    };
  }({
    isAudit: isAudit,
    failOnBlocked: failOnBlocked,
    blockedCount: report.blockedCount ?? 0,
    blockedRows: blockedRows
  }), message = "none" === outcome.level ? null : function({blockedCount: blockedCount, blockedRows: blockedRows, engineLabel: engineLabel, isAudit: isAudit}) {
    const base = `${blockedCount} blocked connection(s) detected by buildcage ${engineLabel}`;
    if (isAudit) return base;
    const unexpected = blockedRows.filter(row => !row.expected).length;
    return unexpected === blockedRows.length ? base : 0 === unexpected ? `${base}, all matched known_blocked_rules (expected)` : `${base} (${unexpected} of ${blockedRows.length} distinct blocked host(s) unmatched by known_blocked_rules)`;
  }({
    blockedCount: report.blockedCount ?? 0,
    blockedRows: blockedRows,
    engineLabel: engineLabel,
    isAudit: isAudit
  });
  return {
    blockedRows: blockedRows,
    showExpected: knownBlockedRules.length > 0,
    outcome: outcome,
    message: message
  };
}(report, {
  knownBlockedRules: knownBlockedRules,
  failOnBlocked: failOnBlocked,
  engineLabel: "proxy"
});

let markdown = `## Outbound Traffic Report during Docker Build (${report.mode} mode)\n\n`;

if (isAudit) {
  const audited = isExplicit ? aggregateAllowedHosts(builds, "AUDIT") : report.sections.audited || [];
  audited.length > 0 && (markdown += "### 📋 Audited Hosts\n\n" + renderHostTable(audited) + "\n"), 
  markdown += function(auditedRows, actionRepo, actionRef, {actionName: actionName = "setup", runCommand: runCommand} = {}) {
    if (!auditedRows || 0 === auditedRows.length) return "";
    const ref = /^[0-9a-f]{40}$/i.test(actionRef) ? "<sha>" : actionRef, groups = new Map;
    for (const r of auditedRows) {
      const param = ruleTypeToParam[r.ruleType];
      param && (groups.has(param) || groups.set(param, []), groups.get(param).push(`${r.host}:${r.port}`));
    }
    if (0 === groups.size) return "";
    let yaml = "";
    if (yaml += "- name: Start Buildcage in restrict mode\n", yaml += `  uses: ${actionRepo}/${actionName}@${ref}\n`, 
    yaml += "  with:\n", "run" === actionName && runCommand) {
      yaml += "    run: |\n";
      for (const line of runCommand.replace(/\r?\n$/, "").split(/\r?\n/)) yaml += `      ${line}\n`;
    }
    yaml += "    proxy_mode: restrict\n";
    for (const [param, rules] of groups) {
      yaml += `    ${param}: >-\n`;
      for (const rule of rules) yaml += `      ${rule}\n`;
    }
    let md = "\n<details>\n";
    return md += "<summary>🛡️ Switch to restrict mode</summary>\n\n", md += "```yaml\n", 
    md += yaml, md += "```\n\n", md += "</details>\n", md;
  }(audited, actionRepo, actionRef), annotatedBlocked.length > 0 && (audited.length > 0 && (markdown += "\n"), 
  markdown += "### 🚫 Blocked Hosts\n\n" + renderHostTable(annotatedBlocked, {
    showReason: !0,
    showExpected: showExpected
  }) + "\n");
} else {
  const allowed = isExplicit ? aggregateAllowedHosts(builds, "ALLOWED") : report.sections.allowed || [];
  allowed.length > 0 && (markdown += "### ✅ Allowed Hosts\n\n" + renderHostTable(allowed) + "\n"), 
  allowed.length > 0 && annotatedBlocked.length > 0 && (markdown += "\n"), annotatedBlocked.length > 0 && (markdown += "### 🚫 Blocked Hosts\n\n" + renderHostTable(annotatedBlocked, {
    showReason: !0,
    showExpected: showExpected
  }) + "\n");
}

isExplicit && (markdown += function(builds, deniedTimeline) {
  const nonEmptyBuilds = (builds || []).filter(b => b && b.length > 0), hasVertexLog = nonEmptyBuilds.length > 0, hasDenied = deniedTimeline && deniedTimeline.length > 0;
  if (!hasVertexLog && !hasDenied) return "";
  let md = "\n<details>\n<summary>💬 Communication details</summary>\n\n";
  if (hasVertexLog) {
    md += "* **✅ Allowed Urls**\n\n";
    const showBuildHeadings = nonEmptyBuilds.length > 1;
    nonEmptyBuilds.forEach((vertices, i) => {
      const indent = showBuildHeadings ? "      " : "   ";
      showBuildHeadings && (md += `   * Build ${i + 1}\n\n`);
      for (const vertex of vertices) md += renderVertexItem(vertex, indent);
    });
  }
  if (hasDenied) {
    md += "* **🚫 Blocked Urls**\n\n";
    for (const {url: url, timestamp: timestamp} of deniedTimeline) md += `   - (${formatSeconds(timestamp)}) ${escapeMarkdown(url)}\n`;
    md += "\n";
  }
  return md += "</details>\n", md;
}(builds, report.deniedTimeline)), isExplicit || (markdown += "\n<sub>*Note: HTTP rules are based on the Host header, HTTPS rules on SNI, and IP rules on the destination IP address.*</sub>\n"), 
markdown += `\n*Reported by [Buildcage](https://github.com/${actionRepo})*\n`;

const summaryFile = process.env.GITHUB_STEP_SUMMARY;

summaryFile ? node_fs.appendFileSync(summaryFile, markdown) : console.log(markdown);

const outputForAction = Boolean(summaryFile), annotation = outputForAction ? {
  notice(message) {
    console.log(`::notice::${message}`);
  },
  error(message) {
    console.log(`::error::${message}`);
  }
} : {
  notice() {},
  error() {}
};

"error" === outcome.level ? (annotation.error(message), process.exitCode = 1) : "notice" === outcome.level && annotation.notice(message);

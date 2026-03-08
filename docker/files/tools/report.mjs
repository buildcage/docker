/**
 * Parse HAProxy logs and output structured JSON.
 *
 * Usage: qjs /opt/buildcage/tools/report.mjs [logfile]
 *   Default logfile: /var/log/haproxy/current
 *
 * Output JSON:
 *   { mode, sections: { allowed, blocked, audited }, blockedCount }
 */
import * as std from "std";
import { parseEntries, aggregate } from "./lib/log-parser.mjs";

const logFile = scriptArgs[1] || "/var/log/haproxy/current";

// Read entire file
function readFile(path) {
  const f = std.open(path, "r");
  if (!f) return "";
  const content = f.readAsString();
  f.close();
  return content;
}

// Main
const logText = readFile(logFile);
const entries = parseEntries(logText);

if (entries.length === 0) {
  std.out.puts(JSON.stringify({ mode: null, sections: {}, blockedCount: 0 }, null, 2) + "\n");
  std.exit(0);
}

const isAudit = entries.some(e => e.decision === "AUDIT");
const mode = isAudit ? "audit" : "restrict";

const sections = {};
if (isAudit) {
  const audited = aggregate(entries.filter(e => e.decision === "AUDIT"));
  if (audited.length > 0) sections.audited = audited;
  const blocked = aggregate(entries.filter(e => e.decision === "BLOCKED"));
  if (blocked.length > 0) sections.blocked = blocked;
} else {
  const allowed = aggregate(entries.filter(e => e.decision === "ALLOWED"));
  if (allowed.length > 0) sections.allowed = allowed;
  const blocked = aggregate(entries.filter(e => e.decision === "BLOCKED"));
  if (blocked.length > 0) sections.blocked = blocked;
}

const blockedCount = entries.filter(e => e.decision === "BLOCKED").length;

const result = { mode, sections, blockedCount };
std.out.puts(JSON.stringify(result, null, 2) + "\n");

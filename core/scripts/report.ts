/**
 * Parse HAProxy's own log file and print a single JSON report to stdout:
 * `{ mode, sections, blockedCount, blocked?, message?, stepSummary, rawLog }`.
 * Runs inside the container, invoked by report.sh (see
 * setup/docker/transparent/files/report.sh) — this way both the log format
 * and the log's file path always match whatever this same image actually
 * produces, regardless of which version of the `report` action is calling
 * it.
 *
 * `sections`/`blockedCount` are the same raw, unannotated shape this script
 * has always produced (`ReportData` in core/lib/report/report-data.ts) —
 * kept for run/src/lib/report.ts, which renders its own per-step markdown
 * (with its own known_blocked_rules/fail_on_blocked input, its own
 * actionRepo/actionRef) directly from this container's log rather than
 * going through report.sh/the `report` action at all. `stepSummary`/
 * `blocked`/`message`/`rawLog` are the newer, already-fully-rendered fields
 * the `report` action consumes instead — see report/src/main.ts.
 *
 * `mode` and `known_blocked_rules` are read from this container's own
 * environment (set by `setup`, not passed as arguments) so that report.sh's
 * invocation of this script never needs updating when those inputs change.
 * `stepSummary` still contains `{{GITHUB_ACTION_REPOSITORY}}`/
 * `{{GITHUB_ACTION_REF}}` placeholders — those are only known to the actual
 * `report` action step's own runtime, so report/src/main.ts substitutes
 * them in (scoped to just this field, not the whole JSON payload) after
 * this script exits.
 *
 * Usage: qjs --std -m /opt/buildcage/scripts/report.js
 */
import * as std from "qjs:std";
import { parseEntries } from "../lib/log/haproxy-log-parser.js";
import { aggregate, type AggregatedEntry } from "../lib/log/aggregate.js";
import { splitRuleTokens } from "../lib/acl/wildcard-rules.js";
import { annotateKnownBlocked, buildBlockedMessage, type AnnotatedBlockedRow } from "../lib/report/known-blocked.js";
import { renderHostTable } from "../lib/report/host-table.js";
import { buildRestrictExample } from "../lib/report/build-example.js";

const ACTION_REPO_PLACEHOLDER = "{{GITHUB_ACTION_REPOSITORY}}";
const ACTION_REF_PLACEHOLDER = "{{GITHUB_ACTION_REF}}";
const LOG_FILE = "/var/log/haproxy/current";

function readFile(path: string): string {
  const f = std.open(path, "r");
  if (!f) return "";
  const content = f.readAsString();
  f.close();
  return content;
}

const logText = readFile(LOG_FILE);
const mode = std.getenv("PROXY_MODE") || "restrict";
const knownBlockedRules = splitRuleTokens(std.getenv("KNOWN_BLOCKED_RULES"));

const entries = parseEntries(logText);

if (entries.length === 0) {
  std.out.puts(
    JSON.stringify({ mode: null, sections: {}, blockedCount: 0, stepSummary: "No proxy logs found.\n", rawLog: logText }) + "\n",
  );
  std.exit(0);
}

const isAudit = mode === "audit";
const blockedCount = entries.filter((e) => e.decision === "BLOCKED").length;
const blockedRawRows = aggregate(entries.filter((e) => e.decision === "BLOCKED"));
const blockedRows: AnnotatedBlockedRow[] = annotateKnownBlocked(blockedRawRows, knownBlockedRules);
const showExpected = knownBlockedRules.length > 0;

let markdown = `## Outbound Traffic Report during Docker Build (${mode} mode)\n\n`;
let audited: AggregatedEntry[] = [];
let allowed: AggregatedEntry[] = [];

if (isAudit) {
  audited = aggregate(entries.filter((e) => e.decision === "AUDIT"));
  if (audited.length > 0) markdown += "### 📋 Audited Hosts\n\n" + renderHostTable(audited) + "\n";
  markdown += buildRestrictExample(audited, ACTION_REPO_PLACEHOLDER, ACTION_REF_PLACEHOLDER);
  if (blockedRows.length > 0) {
    if (audited.length > 0) markdown += "\n";
    markdown += "### 🚫 Blocked Hosts\n\n" + renderHostTable(blockedRows, { showReason: true, showExpected }) + "\n";
  }
} else {
  allowed = aggregate(entries.filter((e) => e.decision === "ALLOWED"));
  if (allowed.length > 0) markdown += "### ✅ Allowed Hosts\n\n" + renderHostTable(allowed) + "\n";
  if (allowed.length > 0 && blockedRows.length > 0) markdown += "\n";
  if (blockedRows.length > 0) {
    markdown += "### 🚫 Blocked Hosts\n\n" + renderHostTable(blockedRows, { showReason: true, showExpected }) + "\n";
  }
}

// SNI-based sniffing only applies to the transparent engine — the explicit
// engine terminates TLS itself, so this caveat doesn't apply there.
markdown += "\n<sub>*Note: HTTP rules are based on the Host header, HTTPS rules on SNI, and IP rules on the destination IP address.*</sub>\n";
markdown += `\n*Reported by [Buildcage](https://github.com/${ACTION_REPO_PLACEHOLDER})*\n`;

const sections: { audited?: AggregatedEntry[]; allowed?: AggregatedEntry[]; blocked?: AggregatedEntry[] } = {};
if (audited.length > 0) sections.audited = audited;
if (allowed.length > 0) sections.allowed = allowed;
if (blockedRawRows.length > 0) sections.blocked = blockedRawRows;

const result: {
  mode: string;
  sections: typeof sections;
  blockedCount: number;
  blocked?: boolean;
  message?: string;
  stepSummary: string;
  rawLog: string;
} = {
  mode,
  sections,
  blockedCount,
  stepSummary: markdown,
  rawLog: logText,
};

// `message` is set whenever there's something to report, audit or restrict
// — audit mode still gets a ::notice:: annotation for blocked connections
// (e.g. protocol errors), it just never fails the step. `blocked` (the
// fail/pass signal) is restrict-mode-only: audit mode never fails
// regardless of blocked connections (see core/lib/report/known-blocked.ts's
// determineBlockedOutcome, whose fail-closed-on-empty-rows semantics
// `blocked`'s computation below mirrors).
if (blockedCount > 0) {
  result.message = buildBlockedMessage({ blockedCount, blockedRows, engineLabel: "proxy", isAudit });
}
if (!isAudit) {
  result.blocked = blockedCount > 0 && (blockedRows.length === 0 || blockedRows.some((r) => !r.expected));
}

std.out.puts(JSON.stringify(result) + "\n");

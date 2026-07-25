/**
 * Parse HAProxy logs (piped in on stdin) and print a single JSON report to
 * stdout: `{ mode, blocked?, message?, stepSummary, rawLog }`. Runs inside the
 * container, invoked by report.sh (see setup/docker/transparent/files/report.sh)
 * — this way the parsing logic always matches whatever HAProxy log format
 * this same image produces, regardless of which version of the `report`
 * action is calling it.
 *
 * `mode` and `known_blocked_rules` are read from this container's own
 * environment (set by `setup`, not passed as arguments) so that report.sh's
 * invocation of this script never needs updating when those inputs change.
 * `stepSummary` still contains `{{GITHUB_ACTION_REPOSITORY}}`/
 * `{{GITHUB_ACTION_REF}}` placeholders — those are only known to the actual
 * `report` action step's own runtime, so report.sh substitutes them in
 * after this script exits (see docs on that script for why).
 *
 * Usage: qjs --std -m /opt/buildcage/scripts/report.js < <raw haproxy log>
 */
import * as std from "qjs:std";
import { parseEntries } from "../lib/log/haproxy-log-parser.js";
import { aggregate } from "../lib/log/aggregate.js";
import { splitRuleTokens } from "../lib/acl/wildcard-rules.js";
import { annotateKnownBlocked, buildBlockedMessage, type AnnotatedBlockedRow } from "../lib/report/known-blocked.js";
import { renderHostTable } from "../lib/report/host-table.js";
import { buildRestrictExample } from "../lib/report/build-example.js";

const ACTION_REPO_PLACEHOLDER = "{{GITHUB_ACTION_REPOSITORY}}";
const ACTION_REF_PLACEHOLDER = "{{GITHUB_ACTION_REF}}";

const logText = std.in.readAsString();
const mode = std.getenv("PROXY_MODE") || "restrict";
const knownBlockedRules = splitRuleTokens(std.getenv("KNOWN_BLOCKED_RULES"));

const entries = parseEntries(logText);

if (entries.length === 0) {
  std.out.puts(JSON.stringify({ mode: null, stepSummary: "No proxy logs found.\n", rawLog: logText }) + "\n");
  std.exit(0);
}

const isAudit = mode === "audit";
const blockedCount = entries.filter((e) => e.decision === "BLOCKED").length;
const blockedRows: AnnotatedBlockedRow[] = annotateKnownBlocked(
  aggregate(entries.filter((e) => e.decision === "BLOCKED")),
  knownBlockedRules,
);
const showExpected = knownBlockedRules.length > 0;

let markdown = `## Outbound Traffic Report during Docker Build (${mode} mode)\n\n`;

if (isAudit) {
  const audited = aggregate(entries.filter((e) => e.decision === "AUDIT"));
  if (audited.length > 0) markdown += "### 📋 Audited Hosts\n\n" + renderHostTable(audited) + "\n";
  markdown += buildRestrictExample(audited, ACTION_REPO_PLACEHOLDER, ACTION_REF_PLACEHOLDER);
  if (blockedRows.length > 0) {
    if (audited.length > 0) markdown += "\n";
    markdown += "### 🚫 Blocked Hosts\n\n" + renderHostTable(blockedRows, { showReason: true, showExpected }) + "\n";
  }
} else {
  const allowed = aggregate(entries.filter((e) => e.decision === "ALLOWED"));
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

const result: { mode: string; blocked?: boolean; message?: string; stepSummary: string; rawLog: string } = {
  mode,
  stepSummary: markdown,
  rawLog: logText,
};

// Only meaningful in restrict mode — audit mode never fails regardless of
// blocked connections (see core/lib/report/known-blocked.ts's
// determineBlockedOutcome, whose fail-closed-on-empty-rows semantics this
// mirrors).
if (!isAudit) {
  result.blocked = blockedCount > 0 && (blockedRows.length === 0 || blockedRows.some((r) => !r.expected));
  if (blockedCount > 0) {
    result.message = buildBlockedMessage({ blockedCount, blockedRows, engineLabel: "proxy", isAudit });
  }
}

std.out.puts(JSON.stringify(result) + "\n");

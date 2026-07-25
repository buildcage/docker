/**
 * Parse buildkitd's own debug log file plus buildctl's own build-history/log
 * APIs, and print a single JSON report to stdout:
 *   { mode, blocked?, message?, stepSummary, rawLog }
 *
 * Runs inside the container, invoked by report.sh (see
 * setup/docker/explicit/files/report.sh) — this way the log format, the log's
 * file path, and the buildctl invocation this depends on always match
 * whatever buildkitd version this same image ships, regardless of which
 * version of the `report` action is calling it. Unlike the transparent
 * engine's report.js, this script shells out to `buildctl debug
 * histories`/`debug logs` itself (via qjs:os) rather than expecting an
 * outside caller to have already gathered that — buildkitd's own debug log
 * has no reliable way to attribute allowed requests to a specific RUN step,
 * so the per-command allowed/audited breakdown can only come from
 * buildctl's build-history API.
 *
 * "blocked"/deniedTimeline both come from source-policy denial entries,
 * which buildkitd logs via its own structured logger — aggregated by host
 * here, and as a separate chronological (per-request, not per-RUN-step —
 * BuildKit's own denial log carries no vertex/span identifier to attribute
 * it with) list threaded into the communication-details section. See
 * docs/security.md's "Explicit Proxy Engine" section for the known limit
 * that requests never reaching the internal MITM proxy at all
 * (non-cooperative apps bypassing HTTP_PROXY) leave no trace anywhere.
 *
 * `mode` and `known_blocked_rules` are read from this container's own
 * environment (set by `setup`), not passed as arguments. `stepSummary`
 * still contains `{{GITHUB_ACTION_REPOSITORY}}`/`{{GITHUB_ACTION_REF}}`
 * placeholders — those are only known to the actual `report` action step's
 * own runtime, so report/src/main.ts substitutes them in (scoped to just
 * this field, not the whole JSON payload) after this script exits.
 *
 * Usage: qjs --std -m /opt/buildcage/scripts/report.js
 */
import * as std from "qjs:std";
import * as os from "qjs:os";
import { parseEntries, parseDenialTimeline } from "../../../../core/lib/log/buildkitd-log-parser.js";
import { aggregate } from "../../../../core/lib/log/aggregate.js";
import {
  selectAllRefs,
  parseVertexAllowedLog,
  aggregateAllowedHosts,
  type VertexAllowedEntry,
} from "../../../../core/lib/log/vertex-log.js";
import { bytesToUtf8 } from "../../../../core/lib/log/bytes.js";
import { splitRuleTokens } from "../../../../core/lib/acl/wildcard-rules.js";
import {
  annotateKnownBlocked,
  buildBlockedMessage,
  type AnnotatedBlockedRow,
} from "../../../../core/lib/report/known-blocked.js";
import { renderHostTable } from "../../../../core/lib/report/host-table.js";
import { buildRestrictExample } from "../../../../core/lib/report/build-example.js";
import { renderCommunicationDetails } from "../../../../core/lib/report/command-log.js";

const ACTION_REPO_PLACEHOLDER = "{{GITHUB_ACTION_REPOSITORY}}";
const ACTION_REF_PLACEHOLDER = "{{GITHUB_ACTION_REF}}";

/**
 * Run a subprocess and capture its stdout as text. Reads in a loop since a
 * single os.read() call isn't guaranteed to drain a large pipe (buildctl's
 * rawjson build logs can be substantial) in one shot.
 *
 * Throws if the child didn't exit cleanly — os.waitpid() returns a raw
 * POSIX wait status (verified against a real quickjs-ng 0.11.0 binary:
 * a clean exit is 0, a nonzero exit code is left-shifted into the high
 * byte, e.g. `exit 7` -> 1792 = 7 << 8), not an already-decoded exit code.
 * A zero status is the only "succeeded" case; anything else (nonzero exit
 * or signal termination) is a failure.
 */
function execCapture(args: string[]): string {
  const [rd, wr] = os.pipe();
  const pid = os.exec(args, { stdout: wr, block: false });
  os.close(wr);
  const chunks: Uint8Array[] = [];
  const buf = new Uint8Array(65536);
  for (;;) {
    const n = os.read(rd, buf.buffer, 0, buf.length);
    if (n <= 0) break;
    chunks.push(buf.slice(0, n));
  }
  os.close(rd);
  const [, status] = os.waitpid(pid, 0);
  if (status !== 0) {
    throw new Error(`${args.join(" ")} exited with status ${status >> 8}`);
  }
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const all = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.length;
  }
  return bytesToUtf8(all);
}

/**
 * Every build since the container started, not just the latest one — a
 * workflow may run several builds against the same long-lived buildcage
 * container before calling report once, and each is its own independent
 * buildctl history record (see core/lib/log/vertex-log.ts's selectAllRefs).
 * Best-effort: a buildctl failure here shouldn't take down the whole
 * report, just leave the per-command breakdown empty.
 */
function collectBuilds(): VertexAllowedEntry[][] {
  try {
    const historiesOutput = execCapture(["buildctl", "debug", "histories", "--format", "{{json .}}"]);
    const refs = selectAllRefs(historiesOutput);
    return refs.map((ref) => {
      const rawJsonOutput = execCapture(["buildctl", "debug", "logs", "--progress=rawjson", ref]);
      return parseVertexAllowedLog(rawJsonOutput);
    });
  } catch (e) {
    std.err.puts(`(failed to fetch allowed/audited traffic detail via buildctl: ${(e as Error).message || e})\n`);
    return [];
  }
}

const LOG_FILE = "/var/log/buildkitd/current";

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

const isAudit = mode === "audit";
// blockedCount is the aggregated row count here (not raw denial-event
// count like the transparent engine) — buildkitd's denial log doesn't
// carry the same per-event granularity HAProxy's does.
const blockedRawRows = aggregate(parseEntries(logText));
const blockedCount = blockedRawRows.length;
const blockedRows: AnnotatedBlockedRow[] = annotateKnownBlocked(blockedRawRows, knownBlockedRules);
const showExpected = knownBlockedRules.length > 0;
const deniedTimeline = parseDenialTimeline(logText);

const builds = collectBuilds();

let markdown = `## Outbound Traffic Report during Docker Build (${mode} mode)\n\n`;

if (isAudit) {
  const audited = aggregateAllowedHosts(builds, "AUDIT");
  if (audited.length > 0) markdown += "### 📋 Audited Hosts\n\n" + renderHostTable(audited) + "\n";
  markdown += buildRestrictExample(audited, ACTION_REPO_PLACEHOLDER, ACTION_REF_PLACEHOLDER);
  if (blockedRows.length > 0) {
    if (audited.length > 0) markdown += "\n";
    markdown += "### 🚫 Blocked Hosts\n\n" + renderHostTable(blockedRows, { showReason: true, showExpected }) + "\n";
  }
} else {
  const allowed = aggregateAllowedHosts(builds, "ALLOWED");
  if (allowed.length > 0) markdown += "### ✅ Allowed Hosts\n\n" + renderHostTable(allowed) + "\n";
  if (allowed.length > 0 && blockedRows.length > 0) markdown += "\n";
  if (blockedRows.length > 0) {
    markdown += "### 🚫 Blocked Hosts\n\n" + renderHostTable(blockedRows, { showReason: true, showExpected }) + "\n";
  }
}

markdown += renderCommunicationDetails(builds, deniedTimeline);
markdown += `\n*Reported by [Buildcage](https://github.com/${ACTION_REPO_PLACEHOLDER})*\n`;

const result: { mode: string; blocked?: boolean; message?: string; stepSummary: string; rawLog: string } = {
  mode,
  stepSummary: markdown,
  rawLog: logText,
};

// `message` is set whenever there's something to report, audit or restrict.
// `blocked` (the fail/pass signal) is restrict-mode-only — audit mode never
// fails regardless of blocked connections (mirrors
// core/lib/report/known-blocked.ts's determineBlockedOutcome, including its
// fail-closed-on-empty-rows case). In practice blockedCount is always 0 in
// this engine's audit mode (see core/lib/acl/source-policy.ts — audit mode
// emits an empty policy, so buildkitd's source-policy denial log, which
// blockedCount is derived from, never has anything to report), but this
// mirrors the transparent engine's handling rather than assuming that stays
// true forever.
if (blockedCount > 0) {
  result.message = buildBlockedMessage({ blockedCount, blockedRows, engineLabel: "proxy", isAudit });
}
if (!isAudit) {
  result.blocked = blockedCount > 0 && (blockedRows.length === 0 || blockedRows.some((r) => !r.expected));
}

std.out.puts(JSON.stringify(result) + "\n");

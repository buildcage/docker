/**
 * Parse buildkitd's own debug log and output a structured JSON contract:
 *   { mode, sections: { blocked }, blockedCount, deniedTimeline }
 *
 * Unlike transparent mode's report.js, there is no "allowed"/"audited"
 * section here — buildkitd's own log has no reliable way to attribute
 * allowed requests to a specific RUN step.
 *
 * "blocked"/"deniedTimeline" both come from source-policy denial entries,
 * which buildkitd logs via its own structured logger — aggregated by host
 * here, and as a separate chronological (per-request, not per-RUN-step —
 * BuildKit's own denial log carries no vertex/span identifier to attribute
 * it with) list in `deniedTimeline`. See docs/security.md's "Explicit Proxy
 * Engine" section for the known limit that requests never reaching the
 * internal MITM proxy at all (non-cooperative apps bypassing HTTP_PROXY)
 * leave no trace anywhere.
 *
 * Usage: qjs -m /opt/buildcage/scripts/report.js [logfile]
 *   Default logfile: /var/log/buildkitd/current
 */
import * as std from "std";
import { parseEntries, parseDenialTimeline } from "./lib/buildkitd-log-parser.js";
import { aggregate } from "../shared/lib/aggregate.js";

const logFile = scriptArgs[1] || "/var/log/buildkitd/current";

function readFile(path) {
  const f = std.open(path, "r");
  if (!f) return "";
  const content = f.readAsString();
  f.close();
  return content;
}

const logText = readFile(logFile);
const mode = std.getenv("PROXY_MODE") || "restrict";

const blocked = aggregate(parseEntries(logText));
const deniedTimeline = parseDenialTimeline(logText);

const sections = {};
if (blocked.length > 0) sections.blocked = blocked;

const result = { mode, sections, blockedCount: blocked.length, deniedTimeline };
std.out.puts(JSON.stringify(result, null, 2) + "\n");

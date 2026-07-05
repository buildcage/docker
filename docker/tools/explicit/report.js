/**
 * Parse buildkitd's own debug log (source-policy denials only) and output the
 * same structured JSON contract as transparent mode's report.js:
 *   { mode, sections: { blocked }, blockedCount }
 *
 * There is no "allowed"/"audited" section here: successful (ALLOW) requests
 * are already visible for free in BuildKit's own "proxy network requests:"
 * build output. Requests that never reached the internal MITM proxy at all
 * (non-cooperative apps bypassing HTTP_PROXY) leave no trace anywhere — see
 * docs/security.md's "Explicit Proxy Engine" section for this known limit.
 *
 * Usage: qjs -m /opt/buildcage/tools/explicit/report.js [logfile]
 *   Default logfile: /var/log/buildkitd/current
 */
import * as std from "std";
import { parseEntries } from "./lib/buildkitd-log-parser.js";
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
const blocked = aggregate(parseEntries(logText));

const mode = std.getenv("PROXY_MODE") || "restrict";
const sections = {};
if (blocked.length > 0) sections.blocked = blocked;

const result = { mode, sections, blockedCount: blocked.length };
std.out.puts(JSON.stringify(result, null, 2) + "\n");

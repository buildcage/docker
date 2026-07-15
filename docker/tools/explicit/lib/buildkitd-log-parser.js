/**
 * Parse buildkitd's own debug log for source-policy denial entries.
 *
 * BuildKit's sourcepolicy engine logs a Debug-level "Evaluated source policy"
 * line (logrus text format) whenever a rule denies (or converts) a source —
 * see sourcepolicy/engine.go's evaluatePolicy(). ALLOW decisions are never
 * logged this way. This entry is written by buildkitd's own structured
 * logger and needs no special buildkitd configuration to appear.
 *
 * Real observed line shape (moby/buildkit v0.31.1):
 *   time="2026-07-05T02:26:34Z" level=debug msg="Evaluated source policy"
 *     error="source \"https://blocked.example.com/\" denied by policy: source denied by policy"
 *     mutated=false orig="identifier:\"https://blocked.example.com/\""
 *     ref="https://blocked.example.com/" updated="https://blocked.example.com/"
 *
 * Allowed requests are not parsed from this file. BuildKit's own "proxy
 * network requests:" summary (see solver/llbsolver/ops/exec.go's
 * logProxyRequests()) only appears here when buildkitd runs with
 * BUILDKIT_DEBUG_EXEC_OUTPUT=1, which also mirrors every RUN step's own
 * console output into this same log. report/src/lib/vertex-log.js fetches
 * that data instead via `buildctl debug logs --progress=rawjson`, which
 * tags each entry with its vertex (RUN step) and needs no such flag; it
 * reuses parseAllowedRequestsFromText() below for that per-vertex text, and
 * parseIdentifier() (exported) to resolve host/port for its own
 * host-aggregated table. See report.js and report/src/main.js for how the
 * two are composed.
 */

const deniedLinePattern = /msg="Evaluated source policy".*denied by policy/;
const refFieldPattern = /\bref="((?:[^"\\]|\\.)*)"/;
const timeFieldPattern = /^time="([^"]*)"/;

// Shared for logrus text-format quoted values ("ref=\"...\"", "span=\"...\""),
// which escape embedded quotes as \" and backslashes as \\.
function unescapeLogrusValue(s) {
  return s.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

/**
 * Scan for "Evaluated source policy" denial lines and return each one's raw
 * identifier and timestamp, in log order, with no host/port resolution or
 * aggregation. Shared by parseEntries() (host-aggregated) and
 * parseDenialTimeline() (chronological) below.
 *
 * @param {string} logText
 * @returns {{ url: string, timestamp: string }[]}
 */
function parseDenialEntries(logText) {
  const entries = [];
  for (const line of logText.split("\n")) {
    if (!deniedLinePattern.test(line)) continue;
    const refMatch = line.match(refFieldPattern);
    const timeMatch = line.match(timeFieldPattern);
    if (!refMatch || !timeMatch) continue;
    entries.push({ url: unescapeLogrusValue(refMatch[1]), timestamp: timeMatch[1] });
  }
  return entries;
}

/**
 * @param {string} logText
 * @returns {{ decision: string, ruleType: string, host: string, port: string, reason: string }[]}
 */
export function parseEntries(logText) {
  const entries = [];
  for (const { url } of parseDenialEntries(logText)) {
    const parsed = parseIdentifier(url);
    if (!parsed) continue;
    entries.push({
      decision: "BLOCKED",
      ruleType: parsed.scheme === "https" ? "HTTPS" : "HTTP",
      host: parsed.host,
      port: parsed.port,
      reason: "not-allowed",
    });
  }
  return entries;
}

const proxyRequestsHeader = "proxy network requests:";
const requestLineDetailPattern = /^-\s+(\S+)\s+(\S+?)(?:\s+->\s+(\d+))?$/;

/**
 * Scan arbitrary text for a "proxy network requests:" block and return its
 * raw entries, in order, with no host/port resolution or aggregation. Used
 * by report/src/lib/vertex-log.js, applied to a single RUN vertex's own
 * isolated stderr (decoded from `buildctl debug logs --progress=rawjson`),
 * for both the per-command breakdown and the host-aggregated allowed table.
 *
 * @param {string} text
 * @returns {{ method: string, url: string, status?: number }[]}
 */
export function parseAllowedRequestsFromText(text) {
  const entries = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== proxyRequestsHeader) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const m = lines[j].match(requestLineDetailPattern);
      if (!m) break;
      const [, method, url, status] = m;
      entries.push(status === undefined ? { method, url } : { method, url, status: Number(status) });
    }
  }
  return entries;
}

/**
 * Parse the chronological list of denied requests, each with its own
 * timestamp — unlike parseEntries(), this is neither aggregated by host nor
 * attributed to a RUN step (BuildKit's own denial log carries no vertex/span
 * identifier to attribute it with). Timestamps are whole-seconds only (no
 * sub-second precision), since that is all buildkitd's own logrus text
 * formatter records.
 *
 * @param {string} logText
 * @returns {{ url: string, timestamp: string }[]}
 */
export function parseDenialTimeline(logText) {
  return parseDenialEntries(logText);
}

const DEFAULT_PORT = { https: "443", http: "80" };

/**
 * Parse a proxy-network source identifier ("https://host[:port]/path...")
 * into its scheme/host/port. BuildKit omits an explicit ":443"/":80" from the
 * identifier when the original request didn't specify a port, so a missing
 * port is filled in with the scheme's default. Returns null for non-http(s)
 * identifiers — buildcage's generated policy only ever denies ^https?://
 * sources, but this guards against unexpected input. Exported for reuse by
 * report/src/lib/vertex-log.js, which needs the same host/port resolution
 * for its own host-aggregated allowed table.
 */
export function parseIdentifier(identifier) {
  const m = identifier.match(/^(https?):\/\/([^/]+)/);
  if (!m) return null;
  const [, scheme, hostPort] = m;
  const colonIdx = hostPort.lastIndexOf(":");
  if (colonIdx > 0) {
    return { scheme, host: hostPort.substring(0, colonIdx), port: hostPort.substring(colonIdx + 1) };
  }
  return { scheme, host: hostPort, port: DEFAULT_PORT[scheme] };
}

const eventLinePattern = /buildcage: event=(\{.*\})\s*$/;

/**
 * Scan for buildkit-proxy's own structured event lines (see
 * docker/explicit/buildkit-proxy/events.go's logEvent — the Go standard
 * `log` package prefixes each line with its own date/time, which this
 * pattern ignores by matching from "buildcage: event=" onward) and return
 * each event, in log order. report/src/main.js maps each event's `level`
 * ("notice"/"warning"/"error") directly onto the matching
 * report/src/lib/annotation.js method.
 *
 * A malformed JSON payload is skipped rather than thrown, so one bad line
 * can never abort report generation for an otherwise-successful build.
 *
 * @param {string} logText
 * @returns {{ type: string, level: string, message: string, ref?: string, sessionID?: string }[]}
 */
export function parseBuildcageEvents(logText) {
  const events = [];
  for (const line of logText.split("\n")) {
    const m = line.match(eventLinePattern);
    if (!m) continue;
    try {
      events.push(JSON.parse(m[1]));
    } catch {
      // malformed line — skip rather than crash report generation
    }
  }
  return events;
}

/**
 * Parse buildkitd's own debug log for source-policy denial entries.
 *
 * BuildKit's sourcepolicy engine logs a Debug-level "Evaluated source policy"
 * line (logrus text format) whenever a rule denies (or converts) a source —
 * see sourcepolicy/engine.go's evaluatePolicy(). Only denials are counted
 * here; ALLOW decisions are never logged this way (BuildKit's own
 * "proxy network requests:" build output already covers those).
 *
 * Real observed line shape (moby/buildkit v0.31.1):
 *   time="2026-07-05T02:26:34Z" level=debug msg="Evaluated source policy"
 *     error="source \"https://blocked.example.com/\" denied by policy: source denied by policy"
 *     mutated=false orig="identifier:\"https://blocked.example.com/\""
 *     ref="https://blocked.example.com/" updated="https://blocked.example.com/"
 *
 * aggregate() lives separately in docker/tools/shared/lib/aggregate.js
 * (shared with transparent mode's log-parser.js) — see report.js for how
 * the two are composed.
 */

const deniedLinePattern = /msg="Evaluated source policy".*denied by policy/;
const refFieldPattern = /\bref="((?:[^"\\]|\\.)*)"/;

/**
 * @param {string} logText
 * @returns {{ decision: string, ruleType: string, host: string, port: string, reason: string }[]}
 */
export function parseEntries(logText) {
  const entries = [];
  for (const line of logText.split("\n")) {
    if (!deniedLinePattern.test(line)) continue;
    const refMatch = line.match(refFieldPattern);
    if (!refMatch) continue;
    const identifier = refMatch[1].replace(/\\"/g, '"');
    const parsed = parseIdentifier(identifier);
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

const DEFAULT_PORT = { https: "443", http: "80" };

/**
 * Parse a proxy-network source identifier ("https://host[:port]/path...")
 * into its scheme/host/port. BuildKit omits an explicit ":443"/":80" from the
 * identifier when the original request didn't specify a port (verified
 * against a live moby/buildkit v0.31.1 container), so a missing port is
 * filled in with the scheme's default. Returns null for non-http(s)
 * identifiers — buildcage's generated policy only ever denies ^https?://
 * sources, but this guards against unexpected input.
 */
function parseIdentifier(identifier) {
  const m = identifier.match(/^(https?):\/\/([^/]+)/);
  if (!m) return null;
  const [, scheme, hostPort] = m;
  const colonIdx = hostPort.lastIndexOf(":");
  if (colonIdx > 0) {
    return { scheme, host: hostPort.substring(0, colonIdx), port: hostPort.substring(colonIdx + 1) };
  }
  return { scheme, host: hostPort, port: DEFAULT_PORT[scheme] };
}

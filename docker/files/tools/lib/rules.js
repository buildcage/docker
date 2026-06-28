/**
 * Rule conversion library for buildcage container.
 * Converts wildcard patterns to regex strings for HAProxy ACLs.
 */

/**
 * Build regex rules from a space-separated input string.
 *
 * @param {string} rulesInput
 * @returns {string[]}
 */
export function buildRules(rulesInput) {
  const rules = rulesInput?.trim().split(/\s+/).filter(Boolean) ?? [];
  return rules.map(convertRule);
}

/**
 * Convert a single rule (wildcard or `~`-prefixed regex) to a regex string.
 */
export function convertRule(rule) {
  if (rule.startsWith("~")) {
    const regex = rule.slice(1);
    try { new RegExp(regex); } catch (e) {
      throw new Error(`Invalid regex in rule "${rule}": ${e.message}`);
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
  const regexParts = domain.split(".").map(part => {
    if (part === "**") return ".+";
    if (part === "*") return "[^.]+";
    if (part.includes("*")) {
      throw new Error(`Invalid wildcard in "${domain}": part "${part}" mixes "*" with other characters`);
    }
    // Escape regex meta characters (`?` excluded — it is a wildcard, handled below)
    return part
      .replace(/[.+^$()[\]{}|\\]/g, "\\$&") // escape regex special chars except `?`
      .replace(/\?/g, "[^.]"); // `?` matches a single character excluding dots
  });

  return regexParts.join("\\.");
}

/**
 * Convert a wildcard pattern (`<domain>:<port|*>`) to a regex string (without anchors).
 */
export function wildcardToRegex(pattern) {
  if (!/^[^:]+:(?:\d+|\*)$/.test(pattern)) {
    throw new Error(`Invalid pattern "${pattern}"`);
  }
  const [domain, port] = pattern.split(":");
  const portRegex = port === "*" ? "\\d+" : port;
  return `${domainToRegex(domain)}:${portRegex}`;
}

/**
 * Rule conversion library for buildcage container.
 * Converts wildcard patterns to regex strings for HAProxy ACLs.
 */

/**
 * Split a whitespace-separated rules string into individual rule tokens.
 *
 * @param {string|undefined} rulesInput
 * @returns {string[]}
 */
export function splitRuleTokens(rulesInput) {
  return rulesInput?.trim().split(/\s+/).filter(Boolean) ?? [];
}

/**
 * Build regex rules from a space-separated input string.
 *
 * @param {string} rulesInput
 * @returns {string[]}
 */
export function buildRules(rulesInput) {
  return splitRuleTokens(rulesInput).map(convertRule);
}

/**
 * Split+validate a space-separated rules string, returning the raw
 * (unconverted) rule tokens — for callers that need the original
 * wildcard/~regex syntax preserved, such as known_blocked_rules.
 *
 * @param {string|undefined} rulesInput
 * @returns {string[]}
 * @throws {Error} if any rule has invalid wildcard/regex syntax
 */
export function parseAndValidateRules(rulesInput) {
  const rules = splitRuleTokens(rulesInput);
  rules.forEach(convertRule); // validate eagerly; throws on bad syntax
  return rules;
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

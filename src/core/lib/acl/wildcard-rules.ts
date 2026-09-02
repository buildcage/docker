/**
 * Rule conversion library for buildcage container.
 * Converts wildcard patterns to regex strings for HAProxy ACLs.
 */

import { splitRawRegexHost } from "./partial-wildcard.ts";

/**
 * Split a whitespace-separated rules string into individual rule tokens.
 */
export function splitRuleTokens(rulesInput: string | undefined): string[] {
  return rulesInput?.trim().split(/\s+/).filter(Boolean) ?? [];
}

/**
 * Build regex rules from a space-separated input string.
 */
export function buildRules(rulesInput: string): string[] {
  return splitRuleTokens(rulesInput).map(convertRule);
}

/**
 * Split+validate a space-separated rules string, returning the raw
 * (unconverted) rule tokens — for callers that need the original
 * wildcard/~regex syntax preserved, such as known_blocked_rules.
 *
 * @throws {Error} if any rule has invalid wildcard/regex syntax
 */
export function parseAndValidateRules(rulesInput: string | undefined): string[] {
  const rules = splitRuleTokens(rulesInput);
  rules.forEach(convertRule); // validate eagerly; throws on bad syntax
  return rules;
}

/**
 * Convert a single rule (wildcard or `~`-prefixed regex) to a regex string.
 *
 * The `~` case reuses the `inspect` engine's own validator (a port is always
 * required there too) so both engines reject the same malformed regex the
 * same way, instead of this engine silently accepting a rule that then never
 * matches -- or, absent an anchor, matches more than the author intended.
 */
export function convertRule(rule: string): string {
  if (rule.startsWith("~")) {
    splitRawRegexHost(rule);
    return rule.slice(1);
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
export function domainToRegex(domain: string): string {
  const regexParts = domain.split(".").map((part) => {
    if (part === "**") return ".+";
    if (part === "*") return "[^.]+";
    if (part.includes("*")) {
      throw new Error(
        `Invalid wildcard in "${domain}": part "${part}" mixes "*" with other characters`,
      );
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
export function wildcardToRegex(pattern: string): string {
  if (!/^[^:]+:(?:\d+|\*)$/.test(pattern)) {
    throw new Error(`Invalid pattern "${pattern}"`);
  }
  const [domain, port] = pattern.split(":");
  const portRegex = port === "*" ? "\\d+" : port;
  return `${domainToRegex(domain)}:${portRegex}`;
}

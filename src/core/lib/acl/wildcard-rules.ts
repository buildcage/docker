/**
 * Rule conversion library for the buildcage container.
 * Converts wildcard patterns to regex strings for HAProxy ACLs.
 */

import { stripLineComment, rejectGluedHash } from "../line-comments.ts";
import { IPV4_CIDR } from "./ipv4.ts";
import {
  anchorRawRegex,
  checkHostLabel,
  endsAnchored,
  splitDomainFromPortPattern,
  splitRawRegexHost,
} from "./partial-wildcard.ts";
import { convertUrlRule } from "./url-rules.ts";

/**
 * Split a whitespace-separated rules input into tokens, first dropping each
 * line's `#` comment. Newlines are only a kind of whitespace here, so the
 * comment-stripped lines are rejoined and split as one. A `#` glued to a token
 * is rejected per token (see rejectGluedHash), so the error names the token at
 * fault rather than the whole line.
 */
export function splitRuleTokens(rulesInput: string | undefined): string[] {
  const tokens =
    rulesInput
      ?.split(/\r?\n/)
      .map(stripLineComment)
      .join(" ")
      .trim()
      .split(/\s+/)
      .filter(Boolean) ?? [];
  tokens.forEach(rejectGluedHash);
  return tokens;
}

export function buildRules(rulesInput: string): string[] {
  return splitRuleTokens(rulesInput).map(convertRule);
}

/**
 * Split+validate a whitespace-separated rules string, returning the raw
 * (unconverted) rule tokens, for callers that need the original wildcard or
 * `~` regex syntax preserved, such as known_blocked_rules.
 *
 * @throws {Error} if any rule has invalid wildcard/regex syntax
 */
export function parseAndValidateRules(rulesInput: string | undefined): string[] {
  const rules = splitRuleTokens(rulesInput);
  rules.forEach(convertRule); // validate eagerly; throws on bad syntax
  return rules;
}

/**
 * `known_blocked_rules` only: give a rule that names no port the `:*` the
 * syntax otherwise requires.
 *
 * Every other rule input is matched against a connection, where the port is
 * part of what is being permitted. This one is matched against a row of the
 * report, and a row for a name the resolver refused has no port at all,
 * nothing having been connected to. Requiring one there means writing a port
 * that was never involved, and that is true of every DNS row.
 */
export function completeRulePort(rule: string): string {
  if (!rule.startsWith("~")) return rule.includes(":") ? rule : `${rule}:*`;
  const regex = rule.slice(1);
  if (splitDomainFromPortPattern(regex).portPattern !== null) return rule;
  // Appended after a closing anchor the port would match nothing, so the
  // anchor comes off and convertRule's anchorRawRegex puts it back.
  return `~${endsAnchored(regex) ? regex.slice(0, -1) : regex}:\\d+`;
}

/**
 * Split a `known_blocked_rules` input into one rule per line. Unlike the
 * whitespace-separated host rule inputs, this one is newline-separated so a
 * line can be a URL rule, which carries a space between its method and its
 * URL (see isKnownBlockedUrlRule). Each line's `#` comment is dropped first, a
 * blank line is ignored, and a `#` glued to a rule is rejected per line.
 */
export function splitKnownBlockedLines(rulesInput: string | undefined): string[] {
  const lines =
    rulesInput
      ?.split(/\r?\n/)
      .map((line) => stripLineComment(line).trim())
      .filter((line) => line !== "") ?? [];
  lines.forEach(rejectGluedHash);
  return lines;
}

/**
 * Whether a `known_blocked_rules` line is a URL rule rather than a host rule.
 *
 * A URL rule carries a space between its method and its URL; a host rule is a
 * bare `host:port`. So the space tells them apart, the same split convertUrlRule
 * makes internally, and a line with stray whitespace is read as a malformed URL
 * rule rather than a host rule.
 */
export function isKnownBlockedUrlRule(line: string): boolean {
  return /\s/.test(line.trim());
}

/**
 * Split+validate `known_blocked_rules`, one rule per line. A host line has its
 * missing port completed (see completeRulePort) and is returned in completed
 * form; a URL line is validated through the `inspect` engine's own compiler and
 * returned as written. Everything downstream re-classifies a line the same way
 * (see isKnownBlockedUrlRule), so the two forms round-trip through the
 * container's env unchanged.
 *
 * Engine support is checked separately (see engine-rule-support.ts): a URL line
 * matches nothing on an engine that never sees a method or a path.
 *
 * @throws {Error} if any rule has invalid wildcard/regex/URL syntax
 */
export function parseAndValidateKnownBlockedRules(rulesInput: string | undefined): string[] {
  return splitKnownBlockedLines(rulesInput).map((line) => {
    if (isKnownBlockedUrlRule(line)) {
      convertUrlRule(line); // validate eagerly; throws on bad syntax
      return line;
    }
    const completed = completeRulePort(line);
    convertRule(completed); // validate eagerly; throws on bad syntax
    return completed;
  });
}

/**
 * Convert a single rule (wildcard or `~`-prefixed regex) to a regex string.
 *
 * The `~` case reuses the `inspect` engine's own validator (a port is always
 * required there too) so both engines reject the same malformed regex the
 * same way, instead of this engine silently accepting a rule that then never
 * matches. anchorRawRegex then makes it cover a whole `host:port`, as a
 * wildcard rule does.
 */
export function convertRule(rule: string): string {
  if (rule.startsWith("~")) {
    splitRawRegexHost(rule);
    return anchorRawRegex(rule.slice(1));
  }
  return `^${wildcardToRegex(rule)}$`;
}

/**
 * A CIDR block as a regex over the dotted addresses it covers, since the
 * `universal` engine matches an IP rule against the address as text. An octet
 * the prefix fixes is written out, one it partly fixes lists its values, and
 * one it leaves free takes any number.
 */
function cidrToRegex(cidr: string): string {
  const [address, prefix] = cidr.split("/");
  return address
    .split(".")
    .map((octet, i) => {
      const bits = Math.min(Math.max(Number(prefix) - 8 * i, 0), 8);
      if (bits === 0) return "[0-9]+";
      const low = Number(octet) & (0xff << (8 - bits)) & 0xff;
      if (bits === 8) return String(low);
      const values = Array.from({ length: 2 ** (8 - bits) }, (_, n) => low + n);
      return `(?:${values.join("|")})`;
    })
    .join("\\.");
}

/**
 * Convert a domain wildcard to a regex string (without anchors or port).
 *
 * A dot-separated part containing `*` must be exactly `*` or `**`.
 * A CIDR block skips the label check, which would refuse its `/`.
 */
function domainToRegex(domain: string): string {
  if (/^[\d.]+\/\d+$/.test(domain)) {
    if (!IPV4_CIDR.test(domain)) {
      throw new Error(
        `Invalid CIDR block "${domain}": each octet is a decimal from 0 to 255 without a ` +
          `leading zero, and the prefix is 0 to 32`,
      );
    }
    return cidrToRegex(domain);
  }
  const regexParts = domain.split(".").map((part) => {
    checkHostLabel(part, domain);
    if (part === "**") return ".+";
    if (part === "*") return "[^.]+";
    if (part.includes("*")) {
      throw new Error(
        `Invalid wildcard in "${domain}": part "${part}" mixes "*" with other characters`,
      );
    }
    // Escape regex meta characters, `?` excluded: it is a wildcard, handled below
    return part.replace(/[.+^$()[\]{}|\\]/g, "\\$&").replace(/\?/g, "[^.]");
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

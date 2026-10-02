/**
 * URL rule compiler for the `inspect` engine.
 *
 * A rule is a method list followed by a URL pattern:
 *
 *   GET https://registry.npmjs.org/@myorg/**
 *   GET|HEAD https://example.com/public/*
 *   * https://internal.example.com
 *
 * The method is required: there is no default, so a rule always states what it
 * permits.
 * Because a rule contains a space, the input is split on NEWLINES, unlike the
 * whitespace-separated host rules in wildcard-rules.ts.
 *
 * The URL pattern extends the host rule syntax to a path, applying the same
 * wildcard vocabulary to path segments instead of dot-separated labels. A
 * wildcard may sit among literal text, in a path segment as in a domain label;
 * see partial-wildcard.ts, which holds the vocabulary and why that matters.
 *
 * A `~` prefix on the URL passes the remainder through as a raw regex. Nothing
 * here is matched as one full-URL expression either way: haproxy matches the
 * authority and the path as two separate ACLs (see haproxy-rule-block.ts), and
 * the host half alone becomes the resolver's allowlist (see coredns-config.ts).
 *
 * Path traversal is not handled here: `*` cannot cross a `/`, but a segment
 * that is itself `..` still matches it, and `**` crosses freely, so haproxy
 * decodes and strips `..` from the path before any rule sees it; see
 * haproxy-inspect-stage.ts.
 */

import { stripLineComment, rejectGluedHash } from "../line-comments.ts";
import {
  anchorRawRegex,
  checkPort,
  checkRawRegexHalf,
  pathToRegexPartial,
  splitDomainFromPortPattern,
  wildcardToRegexPartial,
} from "./partial-wildcard.ts";

/** The scheme's default port, used wherever a rule names none. */
export const DEFAULT_PORT: Record<"https" | "http", string> = { https: "443", http: "80" };

export type UrlScheme = "https" | "http";

export interface UrlRule {
  /** Uppercased HTTP methods, or null when the rule allows any method (`*`). */
  methods: string[] | null;
  /**
   * The schemes the rule covers: one for a literal URL, both for a `~` rule
   * whose scheme is written `https?`.
   */
  schemes: UrlScheme[];
  /**
   * Host-only regex (no port), which the resolver's allowlist is built from:
   * a DNS query carries no port to match against. For a `~` rule, this is
   * `hostRegex` with anything after its own `:` discarded; see
   * splitRawRegexUrl.
   */
  authorityRegex: string;
  /** Regex matching the path alone, anchored at the start. */
  pathRegex: string;
  /**
   * For a `~` rule: the host half's own regex, port included verbatim if the
   * user wrote one. The proxy matches this against the connection's host
   * both with and without a port, since the pattern's port (if any) is
   * optional; see haproxy-config.ts. Meaningless when `isRegex` is false,
   * since a wildcard rule's host and (literal) port are matched separately.
   */
  hostRegex: string;
  /** Whether this is a `~` rule. */
  isRegex: boolean;
  /** The rule exactly as the user wrote it, for reports and error messages. */
  raw: string;
}

/**
 * Parse the method list preceding a URL.
 *
 * @throws {Error} if a method is not a bare token
 */
export function parseMethods(spec: string, rule: string): string[] | null {
  const tokens = spec
    .split(/[|,]/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    throw new Error(`Invalid rule "${rule}": no method given`);
  }
  // `*` anywhere in the list means the rule is not method-restricted at all.
  if (tokens.includes("*")) return null;
  for (const token of tokens) {
    if (!/^[A-Za-z]+$/.test(token)) {
      throw new Error(`Invalid method "${token}" in rule "${rule}"`);
    }
  }
  // De-duplicate so the generated ACL has no repeats.
  return [...new Set(tokens.map((t) => t.toUpperCase()))];
}

/**
 * Split a URL pattern into scheme, authority (host:port) and path.
 *
 * @throws {Error} if the pattern is not an http(s) URL, or carries a fragment
 */
function splitUrl(
  url: string,
  rule: string,
): { scheme: UrlScheme; authority: string; path: string } {
  const match = /^(https?):\/\/([^/]+)(\/.*)?$/.exec(url);
  if (!match) {
    throw new Error(
      `Invalid URL in rule "${rule}": expected http:// or https:// followed by a host`,
    );
  }
  // A fragment stays in the browser, so it is never part of the path a request
  // carries and a rule naming one could only ever match nothing. Easy to copy
  // in from a documentation link, so it is refused rather than left to fail
  // silently. (splitUrlRuleLines already rejects a `#` in the input; this
  // guards a direct caller.)
  if (url.includes("#")) {
    throw new Error(
      `Invalid URL in rule "${rule}": a "#" fragment is never sent with a request, so this rule ` +
        `would match nothing. Drop it.`,
    );
  }
  return { scheme: match[1] as UrlScheme, authority: match[2], path: match[3] ?? "" };
}

/** A literal `/`, or its escaped form `\/`. */
const SLASH_TOKEN = /\\?\//;
/** `://`, with either slash possibly escaped. */
const SCHEME_SEP = /:(?:\\?\/){2}/;

/** The scheme spellings a `~` rule may open with, and the buckets each lands in. */
const RAW_REGEX_SCHEMES = new Map<string, UrlScheme[]>([
  ["https", ["https"]],
  ["http", ["http"]],
  ["https?", ["https", "http"]],
]);

/**
 * The schemes a `~` rule covers, read from what precedes its `://`. Only fixed
 * spellings: the proxy buckets rules by listener, which a regex cannot name.
 *
 * @throws {Error} if the scheme is not `https`, `http` or `https?`
 */
function rawRegexSchemes(prefix: string, rule: string): UrlScheme[] {
  const scheme = prefix.startsWith("^") ? prefix.slice(1) : prefix;
  const schemes = RAW_REGEX_SCHEMES.get(scheme);
  if (!schemes) {
    throw new Error(
      `Invalid regex in rule "${rule}": the scheme "${scheme}" must be written "https", "http" ` +
        `or "https?", so the rule can be matched against the listener a request arrives on`,
    );
  }
  return schemes;
}

/**
 * Userinfo (`user@host`) is never part of the Host a request carries, so a host
 * holding an `@` could only ever match nothing.
 *
 * @throws {Error} if `host` holds an `@`
 */
function rejectUserinfo(host: string, rule: string): void {
  if (host.includes("@")) {
    throw new Error(
      `Invalid URL in rule "${rule}": "${host}" holds an "@", but a request's Host never carries ` +
        `a user name, so this rule would match nothing. Drop everything up to the "@".`,
    );
  }
}

/**
 * Split a `~` rule's raw regex into a host half and a path half: the
 * `inspect` engine matches a URL rule's host and path as two separate
 * expressions, never as one full-URL regex (see haproxy-rule-block.ts's
 * ruleBlock), so the regex has to be cut at the first `/` after `://`.
 *
 * Both halves are anchored where the author could not do it themselves (see
 * anchorRawRegex), except the path half's end: a `$` there lands at the end of
 * the URL, so whether the path is exact or a prefix stays the author's to say.
 *
 * The host half's port is optional, exactly as in a literal URL: the proxy
 * tries it against the connection's host both bare and with the real port, so
 * a pattern with no port at all matches only the scheme's default port, and
 * one ending in an optional port group (`(:8443)?`) matches either.
 * `authorityRegex` is the same host half with its port pattern dropped (see
 * splitDomainFromPortPattern); the resolver's allowlist has no notion of a
 * port either way.
 *
 * @throws {Error} if the text can't be split into a host and a path, the
 *   scheme is not one of RAW_REGEX_SCHEMES, the host half holds an `@`, either
 *   half carries a top-level `|`, the host half holds a character no hostname
 *   can, or a half fails to compile as a regex on its own
 */
function splitRawRegexUrl(
  regex: string,
  rule: string,
): { schemes: UrlScheme[]; hostRegex: string; authorityRegex: string; pathRegex: string } {
  // Over the whole expression: the per-half checks see only what follows the
  // first "://", so a "|" before it would drop its own branch in silence.
  checkRawRegexHalf(regex, "expression", rule, false);
  const schemeSep = SCHEME_SEP.exec(regex);
  if (!schemeSep) {
    throw new Error(
      `Invalid regex in rule "${rule}": expected "://" (or an escaped equivalent like ` +
        `":\\/\\/ ") separating the scheme from the host, so the host and path can be matched ` +
        `separately`,
    );
  }
  const schemes = rawRegexSchemes(regex.slice(0, schemeSep.index), rule);
  const hostStart = schemeSep.index + schemeSep[0].length;
  const pathSep = SLASH_TOKEN.exec(regex.slice(hostStart));
  if (!pathSep) {
    throw new Error(
      `Invalid regex in rule "${rule}": expected a "/" (or "\\/") after "://" to start the path; ` +
        `a host-only rule belongs in allowed_https_rules instead`,
    );
  }
  const pathStart = hostStart + pathSep.index;

  const hostPart = regex.slice(hostStart, pathStart);
  const pathPart = regex.slice(pathStart);
  checkRawRegexHalf(hostPart, "host half", rule, false);
  checkRawRegexHalf(pathPart, "path half", rule, false);
  rejectUserinfo(hostPart, rule);
  const { domain: hostOnly } = splitDomainFromPortPattern(hostPart);
  checkRawRegexHalf(hostOnly, "host half", rule, true);

  const hostRegex = anchorRawRegex(hostPart);
  const authorityRegex = anchorRawRegex(hostOnly);
  const pathRegex = `^${pathPart}`;
  for (const [label, fragment] of [
    ["host", hostRegex],
    ["host-only", authorityRegex],
    ["path", pathRegex],
  ] as const) {
    try {
      new RegExp(fragment);
    } catch (e) {
      throw new Error(
        `Invalid regex in rule "${rule}": the ${label} part "${fragment}" does not compile on its ` +
          `own: ${(e as Error).message}`,
      );
    }
  }

  return { schemes, hostRegex, authorityRegex, pathRegex };
}

/**
 * The proxy matches the path without its query, so a copied-in query string
 * would match nothing. A `?` not followed by `=` or `&` stays a wildcard.
 *
 * @throws {Error} if the path carries a query string
 */
function rejectQuery(path: string, rule: string): void {
  const query = path.indexOf("?");
  if (query !== -1 && /[=&]/.test(path.slice(query))) {
    throw new Error(
      `Invalid URL in rule "${rule}": "${path.slice(query)}" reads as a query string, but a rule ` +
        `matches the path only and a query is never matched. Drop everything from the "?"; a ` +
        `"?" in a path is a single-character wildcard.`,
    );
  }
}

/**
 * Compile the URL half of a rule into the regexes the proxy matches with: the
 * authority, always carrying an explicit port, and the path.
 *
 * A pattern with no path matches any path on that host, which keeps a URL
 * rule without a path equivalent to the host rule it looks like.
 *
 * @throws {Error} if the pattern has invalid URL or wildcard syntax
 */
function compileUrl(
  url: string,
  rule: string,
): {
  schemes: UrlScheme[];
  authorityRegex: string;
  pathRegex: string;
  hostRegex: string;
  isRegex: boolean;
} {
  if (url.startsWith("~")) {
    const regex = url.slice(1);
    try {
      new RegExp(regex);
    } catch (e) {
      throw new Error(`Invalid regex in rule "${rule}": ${(e as Error).message}`);
    }
    const { schemes, hostRegex, authorityRegex, pathRegex } = splitRawRegexUrl(regex, rule);
    return { schemes, authorityRegex, pathRegex, hostRegex, isRegex: true };
  }

  const { scheme, authority, path } = splitUrl(url, rule);
  rejectUserinfo(authority, rule);
  rejectQuery(path, rule);
  const colonIndex = authority.lastIndexOf(":");
  const hasPort = colonIndex !== -1 && !authority.slice(colonIndex + 1).includes("]");
  const host = hasPort ? authority.slice(0, colonIndex) : authority;
  const port = hasPort ? authority.slice(colonIndex + 1) : "";

  if (host === "") {
    throw new Error(`Invalid URL in rule "${rule}": missing host`);
  }
  if (port !== "") checkPort(port, rule);

  // Compile the host through the host-rule entry point so the two rule forms
  // can never drift: wildcardToRegexPartial takes `host:port` and returns
  // `<hostRegex>:<portRegex>`.
  const combined = wildcardToRegexPartial(`${host}:${port === "" ? DEFAULT_PORT[scheme] : port}`);
  const hostRegex = combined.slice(0, combined.lastIndexOf(":"));

  const pathRegex = path === "" ? "^/" : `^${pathToRegexPartial(path)}$`;

  const authorityPort = port === "*" ? "[0-9]+" : port === "" ? DEFAULT_PORT[scheme] : port;
  const authorityRegex = `^${hostRegex}:${authorityPort}$`;

  return { schemes: [scheme], authorityRegex, pathRegex, hostRegex, isRegex: false };
}

/**
 * Compile one rule line: `<methods> <url>`.
 *
 * @throws {Error} if the line is malformed
 */
export function convertUrlRule(rule: string): UrlRule {
  const trimmed = rule.trim();
  const separator = /\s+/.exec(trimmed);
  if (!separator) {
    throw new Error(
      `Invalid rule "${trimmed}": expected a method and a URL, e.g. "GET https://example.com/x"`,
    );
  }
  const methodSpec = trimmed.slice(0, separator.index);
  // Non-empty: the separator was found inside an already-trimmed string, so
  // something follows it.
  const url = trimmed.slice(separator.index + separator[0].length).trim();
  if (/\s/.test(url)) {
    throw new Error(`Invalid rule "${trimmed}": URL must not contain whitespace`);
  }

  const methods = parseMethods(methodSpec, trimmed);
  const { schemes, authorityRegex, pathRegex, hostRegex, isRegex } = compileUrl(url, trimmed);
  return { methods, schemes, authorityRegex, pathRegex, hostRegex, isRegex, raw: trimmed };
}

/**
 * Split a rules input into rule lines. Newline-separated, because a rule
 * contains a space between its method list and its URL. Each line's `#`
 * comment is dropped first, and a line left empty is dropped. A `#` glued to a
 * rule is rejected per line (see rejectGluedHash), so the error names the
 * offending rule.
 */
function splitUrlRuleLines(rulesInput: string | undefined): string[] {
  const lines =
    rulesInput
      ?.split(/\r?\n/)
      .map((line) => stripLineComment(line).trim())
      .filter((line) => line !== "") ?? [];
  lines.forEach(rejectGluedHash);
  return lines;
}

/**
 * Compile a newline-separated URL rules input.
 *
 * @throws {Error} if any rule is malformed
 */
export function buildUrlRules(rulesInput: string | undefined): UrlRule[] {
  return splitUrlRuleLines(rulesInput).map(convertUrlRule);
}

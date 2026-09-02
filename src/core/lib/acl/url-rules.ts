/**
 * URL rule compiler for the squid-based proxy engine.
 *
 * A rule is a method list followed by a URL pattern:
 *
 *   GET https://registry.npmjs.org/@myorg/**
 *   GET|HEAD https://example.com/public/*
 *   * https://internal.example.com
 *
 * Methods may be separated by `|` or `,`, and `*` means any method. The method
 * is required: there is no default, so a rule always states what it permits.
 * Because a rule contains a space, the input is split on NEWLINES, unlike the
 * whitespace-separated host rules in wildcard-rules.ts.
 *
 * The URL pattern extends the host rule syntax to a path, reusing the same
 * wildcard vocabulary applied to path segments instead of dot-separated labels:
 *
 *   `**` — matches across separators
 *   `*`  — one or more characters, not crossing a separator
 *   `?`  — a single character
 *
 * A wildcard may sit among literal text, in a path segment as in a domain
 * label; see partial-wildcard.ts for why that matters.
 *
 * A `~` prefix on the URL passes the remainder through as a raw regex. Every
 * generated regex sticks to syntax valid in both JavaScript and POSIX ERE,
 * because squid matches with regcomp(3): no `(?:` groups and no `\\d`. A `~`
 * rule is the user's own, so it must be written in POSIX ERE too.
 *
 * Path traversal is NOT handled here. `*` cannot cross a `/`, but a segment
 * that IS `..` still matches it, and `**` crosses freely — so the generated
 * squid.conf carries one global guard rejecting `..` path segments. Squid
 * decodes %-escapes before matching, so that guard catches the encoded forms
 * too; see the squid config generator.
 */

import { pathToRegexPartial, wildcardToRegexPartial } from "./partial-wildcard.ts";

const DEFAULT_PORT: Record<string, string> = { http: "80", https: "443" };

export interface UrlRule {
  /** Uppercased HTTP methods, or null when the rule allows any method (`*`). */
  methods: string[] | null;
  /** "http" or "https". */
  scheme: string;
  /** Regex matching the full URL, without anchors. */
  regex: string;
  /**
   * Regex matching the authority (`host:port`), which the proxy and resolver
   * configs are both built from. See splitRawRegexUrl for how a `~` rule
   * derives this.
   */
  authorityRegex: string;
  /**
   * Regex matching the path alone, anchored at the start. A proxy that
   * matches the host and the path with separate expressions uses this
   * rather than `regex`.
   */
  pathRegex: string;
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
  // De-duplicate so the generated squid ACL has no repeats.
  return [...new Set(tokens.map((t) => t.toUpperCase()))];
}

/**
 * Split a URL pattern into scheme, authority (host:port) and path.
 *
 * @throws {Error} if the pattern is not an http(s) URL
 */
function splitUrl(url: string, rule: string): { scheme: string; authority: string; path: string } {
  const match = /^(https?):\/\/([^/]+)(\/.*)?$/.exec(url);
  if (!match) {
    throw new Error(
      `Invalid URL in rule "${rule}": expected http:// or https:// followed by a host`,
    );
  }
  return { scheme: match[1], authority: match[2], path: match[3] ?? "" };
}

/** A literal `/`, or its escaped form `\/`. */
const SLASH_TOKEN = /\\?\//;
/** `://`, with either slash possibly escaped. */
const SCHEME_SEP = /:(?:\\?\/){2}/;

/**
 * Split a `~` rule's raw regex into a host half and a path half: the
 * `inspect` engine matches a URL rule's host and path as two separate
 * expressions, never as one full-URL regex (see haproxy-config.ts's
 * ruleBlock), so the regex has to be cut at the first `/` after `://`.
 *
 * HAProxy's `dst_port` ACL only accepts a literal number, never a regex, so
 * a `:` in the host half is honoured only when followed by one; otherwise
 * the rule matches any port.
 *
 * @throws {Error} if the text can't be split into a host and a path, its
 *   port isn't a literal number, or either half fails to compile alone
 */
function splitRawRegexUrl(
  regex: string,
  rule: string,
): { authorityRegex: string; pathRegex: string } {
  const schemeSep = SCHEME_SEP.exec(regex);
  if (!schemeSep) {
    throw new Error(
      `Invalid regex in rule "${rule}": expected "://" (or an escaped equivalent like ` +
        `":\\/\\/ ") separating the scheme from the host, so the host and path can be matched ` +
        `separately`,
    );
  }
  const hostStart = schemeSep.index + schemeSep[0].length;
  const pathSep = SLASH_TOKEN.exec(regex.slice(hostStart));
  if (!pathSep) {
    throw new Error(
      `Invalid regex in rule "${rule}": expected a "/" (or "\\/") after "://" to start the path; ` +
        `a host-only rule belongs in allowed_https_rules instead`,
    );
  }
  const pathStart = hostStart + pathSep.index;

  let hostPart = regex.slice(hostStart, pathStart);
  let port: string | null = null;
  const colonIdx = hostPart.indexOf(":");
  if (colonIdx !== -1) {
    const portText = hostPart.slice(colonIdx + 1);
    if (!/^\d+$/.test(portText)) {
      throw new Error(
        `Invalid regex in rule "${rule}": the port after ":" in the host ("${portText}") must be ` +
          `a literal number, since the destination port cannot be matched with a regex; write a ` +
          `plain number (e.g. "https://host:8443/x") or omit the port entirely to allow any port`,
      );
    }
    port = portText;
    hostPart = hostPart.slice(0, colonIdx);
  }

  // "[0-9]+" is the existing any-port sentinel (splitHostAndPort in
  // haproxy-rules.ts, hostRegexOfUrlRule in coredns-config.ts).
  const authorityRegex = `^${hostPart}:${port ?? "[0-9]+"}$`;
  const pathRegex = `^${regex.slice(pathStart)}`;
  for (const [label, fragment] of [
    ["host", `^${hostPart}$`],
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

  return { authorityRegex, pathRegex };
}

/**
 * Compile the URL half of a rule to a regex matching the URL squid sees.
 *
 * The port is optional in the pattern: when omitted, or when it is the
 * scheme's default, the generated regex accepts both the bare host and the
 * host with an explicit default port, because clients and proxies disagree
 * about whether to spell it out.
 *
 * A pattern with no path matches any path on that host, which keeps a URL
 * rule without a path equivalent to the host rule it looks like.
 *
 * @throws {Error} if the pattern has invalid URL or wildcard syntax
 */
function compileUrl(
  url: string,
  rule: string,
): { scheme: string; regex: string; authorityRegex: string; pathRegex: string } {
  if (url.startsWith("~")) {
    const regex = url.slice(1);
    try {
      new RegExp(regex);
    } catch (e) {
      throw new Error(`Invalid regex in rule "${rule}": ${(e as Error).message}`);
    }
    // A raw regex governs its own scheme; callers that bucket by scheme treat
    // it as https, the stricter of the two.
    const { authorityRegex, pathRegex } = splitRawRegexUrl(regex, rule);
    return { scheme: "https", regex, authorityRegex, pathRegex };
  }

  const { scheme, authority, path } = splitUrl(url, rule);
  const colonIndex = authority.lastIndexOf(":");
  const hasPort = colonIndex !== -1 && !authority.slice(colonIndex + 1).includes("]");
  const host = hasPort ? authority.slice(0, colonIndex) : authority;
  const port = hasPort ? authority.slice(colonIndex + 1) : "";

  if (host === "") {
    throw new Error(`Invalid URL in rule "${rule}": missing host`);
  }
  if (port !== "" && !/^(?:\d+|\*)$/.test(port)) {
    throw new Error(`Invalid port in rule "${rule}": "${port}"`);
  }

  // Compile the host through the host-rule entry point so the two rule forms
  // can never drift: wildcardToRegexPartial takes `host:port` and returns
  // `<hostRegex>:<portRegex>`.
  const combined = wildcardToRegexPartial(`${host}:${port === "" ? DEFAULT_PORT[scheme] : port}`);
  const hostRegex = combined.slice(0, combined.lastIndexOf(":"));
  const portRegex =
    port === "" || port === DEFAULT_PORT[scheme]
      ? `(:${DEFAULT_PORT[scheme]})?`
      : port === "*"
        ? "(:[0-9]+)?"
        : `:${port}`;

  // No path in the pattern means "any path on this host".
  const pathRegex = path === "" ? "(/.*)?" : pathToRegexPartial(path);

  // The authority always carries an explicit port, even where the URL may omit
  // it.
  const authorityPort = port === "*" ? "[0-9]+" : port === "" ? DEFAULT_PORT[scheme] : port;
  const authorityRegex = `^${hostRegex}:${authorityPort}$`;

  return {
    scheme,
    regex: `^${scheme}://${hostRegex}${portRegex}${pathRegex}$`,
    authorityRegex,
    // A rule with no path allows any, which is what the URL regex says too.
    pathRegex: path === "" ? "^/" : `^${pathRegex}$`,
  };
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
  const url = trimmed.slice(separator.index + separator[0].length).trim();
  if (url === "") {
    throw new Error(`Invalid rule "${trimmed}": missing URL`);
  }
  if (/\s/.test(url)) {
    throw new Error(`Invalid rule "${trimmed}": URL must not contain whitespace`);
  }

  const methods = parseMethods(methodSpec, trimmed);
  const { scheme, regex, authorityRegex, pathRegex } = compileUrl(url, trimmed);
  return { methods, scheme, regex, authorityRegex, pathRegex, raw: trimmed };
}

/**
 * Split a rules input into rule lines. Newline-separated, because a rule
 * contains a space between its method list and its URL. A blank line, or a
 * line starting with `#`, is dropped — only a full-line `#`, since a `~`
 * rule's own regex might legitimately contain one.
 */
export function splitUrlRuleLines(rulesInput: string | undefined): string[] {
  return (
    rulesInput
      ?.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#")) ?? []
  );
}

/**
 * Compile a newline-separated URL rules input.
 *
 * @throws {Error} if any rule is malformed
 */
export function buildUrlRules(rulesInput: string | undefined): UrlRule[] {
  return splitUrlRuleLines(rulesInput).map(convertUrlRule);
}

/**
 * Turning a compiled rule's regex into the cheapest HAProxy match that accepts
 * exactly it, and escaping what comes out for the config parser.
 *
 * Pure string work: nothing here reads an option, so the whole layer is
 * decided by its arguments alone.
 */

/**
 * `host_only` strips the port a Host header carries; chained onto it here so
 * every host match, resolution and certificate check also treats a trailing
 * dot (`example.com.`, a valid FQDN form) as the same name it denotes in DNS.
 */
export const HOST_ONLY = "host_only,regsub(\\.$,)";

/**
 * What an SNI or Host must consist of before a rule may match it. A `:` would
 * let a `~` rule's port pattern match a name the resolver then looks up.
 */
export const HOSTNAME_CHARSET = "^[A-Za-z0-9._-]+$";

/**
 * Escape a rule-derived value for HAProxy's config word parser.
 *
 * Unquoted, the parser drops everything from a `#` to the end of the line, so a
 * rule carrying one would silently shorten the ACL it belongs to rather than
 * fail: `^/pkg#frag$` reaches the regex engine as `^/pkg`, allowing every path
 * that merely starts with `/pkg`. A quote opens a quoted string and breaks the
 * config outright.
 *
 * Only ` `, `#`, `\`, `'` and `"` are folded by the parser, and `\` is folded
 * only before one of those: `\.` and `$` arrive at the regex engine as written,
 * which is why every backslash is doubled here. One pass over the original
 * string, so an escape this adds is never escaped again.
 */
export function escapeForHaproxy(value: string): string {
  return value.replace(/[\\#'" ]/g, "\\$&");
}

/**
 * Most rules name a literal host and a literal path or path prefix, which
 * compile to an anchored regex that only ever matches one string or one
 * prefix. `-m str` and `-m beg` decide those without entering the regex
 * engine, and matching runs once per rule per request.
 *
 * Everything else, `~` rules and wildcards included, stays `-m reg`. A pattern
 * is only narrowed when every character between the anchors is literal, so a
 * regex metacharacter anywhere sends it down the regex path untouched.
 */
export interface Matcher {
  /** `-m str`, `-m beg` or `-m reg`. */
  op: string;
  /** The pattern as that operator reads it, before config escaping. */
  pattern: string;
}

/**
 * Characters that mean themselves to both the regex engine and `-m str`.
 *
 * `\.` is the one escape a compiled pattern carries, and a bare `.` is a
 * wildcard. Every regex metacharacter is absent, `+` included: a `~` rule
 * carries the author's own regex, where `/a+` means one or more `a`.
 */
const LITERAL_BODY = /^(?:[A-Za-z0-9_~:@%\-/]|\\\.)*$/;

/** Undo the one escape, now that the pattern is no longer read as a regex. */
function unescape(body: string): string {
  return body.replace(/\\\./g, ".");
}

/** How to match a rule's host, which arrives lowercased in txn.host. */
export function hostMatcher(hostRegex: string): Matcher {
  const body = /^\^(.+)\$$/.exec(hostRegex)?.[1];
  // A name is case-insensitive, and txn.host is lowercased once per request,
  // so the pattern has to be lowercase for -m str to agree with -m reg -i.
  return body !== undefined && LITERAL_BODY.test(body)
    ? { op: "-m str", pattern: unescape(body).toLowerCase() }
    : { op: "-m reg -i", pattern: hostRegex };
}

/**
 * How to match a rule's path, which is matched case-sensitively as sent.
 *
 * `^lit$` accepts one path and `^lit.*$` accepts a prefix, as does `^lit` with
 * no end anchor, which is what a rule permitting any path compiles to (`^/`).
 *
 * The leading `^` is stripped unchecked: every rule shape compiles to one.
 */
export function pathMatcher(pathRegex: string): Matcher {
  const asRegex = { op: "-m reg", pattern: pathRegex };
  let body = pathRegex.slice(1);
  let op = "-m beg";
  if (body.endsWith("$")) {
    body = body.slice(0, -1);
    op = "-m str";
    if (body.endsWith(".*")) {
      body = body.slice(0, -2);
      op = "-m beg";
    }
  }
  // A compiled path always starts with its leading slash. Requiring it keeps
  // an empty pattern, which the config parser could not read, out of the
  // narrowed forms.
  if (!body.startsWith("/") || !LITERAL_BODY.test(body)) return asRegex;
  return { op, pattern: unescape(body) };
}

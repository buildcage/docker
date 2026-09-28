/**
 * Domain pattern compiler for the `inspect` engine, which allows a wildcard
 * inside a label: `abc*.amazonaws.com`.
 *
 * The shared compiler in wildcard-rules.ts rejects that, requiring a label
 * containing `*` to be exactly `*` or `**`. For `universal` that is only
 * a restriction on how a rule can be phrased. For `inspect` it would be a
 * hazard, because the resolver's scope is generated from these same patterns:
 * a rule unable to say "only names beginning with abc" forces the author to
 * write `*.amazonaws.com` instead, widening what is allowed to resolve and
 * therefore what can leak through a DNS query alone.
 *
 * The wildcard vocabulary is otherwise unchanged, and keeps the same meaning
 * wherever it appears in a label:
 *
 *   `**`: one or more characters, dots included
 *   `*` : one or more characters, dots excluded
 *   `?` : a single character, dots excluded
 *
 * Kept separate from wildcard-rules.ts rather than added to it, so widening
 * this grammar cannot change what the `universal` engine accepts.
 */

/** Characters that must be escaped to appear literally in a regex. */
const REGEX_META = /[.+^$()[\]{}|\\]/g;

/** How a wildcard is spelled for one kind of separator. */
interface Vocabulary {
  across: string;
  within: string;
  single: string;
}

const DOMAIN: Vocabulary = { across: ".+", within: "[^.]+", single: "[^.]" };
// A path's `**` is zero or more, so `/pkg/**` also covers `/pkg/` itself.
const PATH: Vocabulary = { across: ".*", within: "[^/]+", single: "[^/]" };

/**
 * Compile one atom (a domain label or a path segment), allowing wildcards to
 * sit among literal text.
 */
function atomToRegex(atom: string, vocab: Vocabulary): string {
  let out = "";
  for (let i = 0; i < atom.length; i++) {
    if (atom[i] === "*") {
      // Longest match first: `**` spans the separator; a single `*` does not.
      if (atom[i + 1] === "*") {
        out += vocab.across;
        i++;
      } else {
        out += vocab.within;
      }
      continue;
    }
    if (atom[i] === "?") {
      out += vocab.single;
      continue;
    }
    out += atom[i].replace(REGEX_META, "\\$&");
  }
  return out;
}

/** What a domain label may hold: a hostname's own characters, and wildcards. */
const HOST_LABEL = /^[A-Za-z0-9_*?-]+$/;

/**
 * Anything else compiles into a rule no connection matches: a Host or SNI
 * carries an internationalized name as punycode, and an empty label names no
 * host.
 *
 * @throws {Error} if the label is empty or holds a character no hostname can
 */
export function checkHostLabel(label: string, domain: string): void {
  if (label === "") {
    throw new Error(`Invalid domain "${domain}": empty label (a leading, trailing or doubled dot)`);
  }
  if (HOST_LABEL.test(label)) return;
  if (/[\u0080-￿]/.test(label)) {
    throw new Error(
      `Invalid domain "${domain}": "${label}" is not ASCII. A connection names an ` +
        `internationalized domain in its punycode form, so write that instead (xn--...)`,
    );
  }
  throw new Error(
    `Invalid domain "${domain}": "${label}" holds a character no hostname can; a label is ` +
      `letters, digits, "-" and "_", with the wildcards "*" and "?"`,
  );
}

/**
 * Convert a domain pattern to a regex string, without anchors or port.
 *
 * @throws {Error} if a label is empty or holds a character no hostname can
 */
export function domainToRegexPartial(domain: string): string {
  return domain
    .split(".")
    .map((label) => {
      checkHostLabel(label, domain);
      return atomToRegex(label, DOMAIN);
    })
    .join("\\.");
}

/**
 * Convert a path pattern to a regex fragment, without anchors and keeping the
 * leading `/`.
 *
 * Empty segments are allowed, unlike domain labels: a path begins with `/`, so
 * splitting always yields one.
 */
export function pathToRegexPartial(path: string): string {
  if (path === "") return "";
  return path
    .split("/")
    .map((segment) => atomToRegex(segment, PATH))
    .join("/");
}

/**
 * Convert a `<domain>:<port|*>` pattern to a regex string, without anchors.
 *
 * Mirrors wildcardToRegex's shape so callers can split the result on the last
 * colon to recover the host and port halves.
 *
 * @throws {Error} if the pattern is malformed
 */
export function wildcardToRegexPartial(pattern: string): string {
  if (!/^[^:]+:(?:\d+|\*)$/.test(pattern)) {
    throw new Error(`Invalid pattern "${pattern}"`);
  }
  const colonIndex = pattern.lastIndexOf(":");
  const domain = pattern.slice(0, colonIndex);
  const port = pattern.slice(colonIndex + 1);
  return `${domainToRegexPartial(domain)}:${port === "*" ? "\\d+" : port}`;
}

/** True if `regex` carries a `|` outside every group and character class. */
function hasTopLevelAlternation(regex: string): boolean {
  let depth = 0;
  let inClass = false;
  for (let i = 0; i < regex.length; i++) {
    const c = regex[i];
    if (c === "\\") {
      i++;
    } else if (inClass) {
      if (c === "]") inClass = false;
    } else if (c === "[") {
      inClass = true;
    } else if (c === "(") {
      depth++;
    } else if (c === ")") {
      depth--;
    } else if (c === "|" && depth === 0) {
      return true;
    }
  }
  return false;
}

/**
 * A bracket written as a literal. One in the half taken for the host means
 * the `:` the split chose was not the port separator, an IPv6 authority
 * (`\[::1\]:443`) above all. A character class keeps its `[` unescaped, so
 * `web[0-9]\.example\.com` is unaffected.
 */
const HOST_LITERAL_ILLEGAL = /\\[[\]]/;

/**
 * Text a host half cannot carry into the Corefile, where it sits inside a
 * single-quoted CEL literal: `'` or a backtick would end it, and `{$` or `{%`
 * starts the Corefile's own environment substitution.
 */
const COREFILE_UNSAFE = /['`]|\{[$%]/;

/**
 * Lookaround and backreferences, which RE2 lacks: a host half also goes into
 * the resolver's allowlist, where they would stop the resolver from starting.
 * checkEscapes has already refused a named one (`\k<n>`).
 */
const RE2_UNSUPPORTED = /^(?:\(\?<?[=!]|\\[1-9])/;

function checkResolverRegexSyntax(text: string, label: string, rule: string): void {
  let inClass = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (!inClass) {
      const unsupported = RE2_UNSUPPORTED.exec(text.slice(i));
      if (unsupported) {
        throw new Error(
          `Invalid regex in rule "${rule}": the ${label} "${text}" uses "${unsupported[0]}". ` +
            `Lookaround and backreferences are not supported in a host pattern, which the ` +
            `resolver matches with RE2`,
        );
      }
    }
    if (c === "\\") {
      i++;
    } else if (inClass) {
      if (c === "]") inClass = false;
    } else if (c === "[") {
      inClass = true;
    }
  }
}

/**
 * Letter and digit escapes that JavaScript (these checks) and PCRE2 (the
 * proxy) read alike. Others can hide a top-level `|`: PCRE2 reads `\Q[\E` as
 * a literal `[` and `\c[` as one character, where JavaScript sees a class
 * opening. A backreference is one digit, since the two read `\12` by
 * different rules.
 */
const PORTABLE_ESCAPE = /^(?:[dDwWsSbBnrtf]|[1-9](?!\d))/;

function checkEscapes(text: string, label: string, rule: string): void {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "\\") continue;
    const rest = text.slice(++i);
    if (PORTABLE_ESCAPE.test(rest)) continue;
    const escape = /^(?:\d+|[A-Za-z])/.exec(rest);
    if (escape) {
      throw new Error(
        `Invalid regex in rule "${rule}": the ${label} "${text}" uses "\\${escape[0]}". The ` +
          `proxy's PCRE2 reads it differently from setup, so a backslash may precede only ` +
          `punctuation, one of \\d \\D \\w \\W \\s \\S \\b \\B \\n \\r \\t \\f, or a single ` +
          `backreference digit`,
      );
    }
  }
}

/**
 * Check part of a `~` rule against what the rule syntax can represent.
 *
 * @throws {Error} if the text uses an escape outside PORTABLE_ESCAPE, carries a
 *   top-level `|`, or a host half holds a character no hostname can or text the
 *   resolver's config cannot quote
 */
export function checkRawRegexHalf(
  text: string,
  label: string,
  rule: string,
  hostHalf: boolean,
): void {
  checkEscapes(text, label, rule);
  if (hostHalf) checkResolverRegexSyntax(text, label, rule);
  if (hasTopLevelAlternation(text)) {
    throw new Error(
      `Invalid regex in rule "${rule}": the ${label} "${text}" has a top-level "|". Anchors bind ` +
        `to its first and last branch rather than to the whole ${label}, so write one rule per ` +
        `alternative, or put the "|" inside a group, as in "(a|b)\\.example\\.com"`,
    );
  }
  if (hostHalf && HOST_LITERAL_ILLEGAL.test(text)) {
    throw new Error(
      `Invalid regex in rule "${rule}": the ${label} "${text}" holds a character no hostname can, ` +
        `so the ":" this rule was split at is not its port separator. An IPv6 address is not ` +
        `supported here, in a "~" rule any more than in a literal one`,
    );
  }
  if (hostHalf && COREFILE_UNSAFE.test(text)) {
    throw new Error(
      `Invalid regex in rule "${rule}": the ${label} "${text}" holds a "'", a backtick, "{$" or "{%". ` +
        `No hostname contains one, and the resolver's config cannot quote it`,
    );
  }
}

/** True if `regex` ends in a `$` that is an anchor rather than a literal. */
export function endsAnchored(regex: string): boolean {
  if (!regex.endsWith("$")) return false;
  let backslashes = 0;
  for (let i = regex.length - 2; i >= 0 && regex[i] === "\\"; i--) backslashes++;
  return backslashes % 2 === 0;
}

/**
 * Anchor a `~` rule's host half at both ends.
 *
 * Both engines match a `~` rule as a search rather than a full match
 * (HAProxy's `-m reg`, CEL's `matches`), so an unanchored `~example\.com:443`
 * would also admit `evil-example.com:4430`. A URL rule's author cannot write
 * the anchors themselves: the host half's `^` goes to the scheme and its `$`
 * to the path, and a host rule is treated the same way.
 *
 * Concatenation suffices because checkRawRegexHalf has already refused a
 * top-level `|`, the one construct it would bind to only half of.
 */
export function anchorRawRegex(regex: string): string {
  return `${regex.startsWith("^") ? "" : "^"}${regex}${endsAnchored(regex) ? "" : "$"}`;
}

/**
 * Where a port pattern starts in a `<host>[:<port>]` regex fragment written
 * by a user: a bare `:`, or the `(` of a group opening right at the colon
 * (`(:8443)?`, `(:443|:8443)`). Splitting there, rather than at the last `:`
 * in the whole fragment, keeps a port group's own `(` out of the host half
 * so both halves stay balanced regexes on their own.
 *
 * A `:` that is escaped, inside a character class, or part of a group's own
 * syntax (`(?:`, `(?i:`) is not a port separator, so `(?:a|b)\.com:443`
 * splits at its last colon.
 *
 * @returns the index, or -1 when the fragment names no port
 */
function portPatternStart(hostPlusPort: string): number {
  let inClass = false;
  for (let i = 0; i < hostPlusPort.length; i++) {
    const c = hostPlusPort[i];
    if (c === "\\") {
      i++;
    } else if (inClass) {
      if (c === "]") inClass = false;
    } else if (c === "[") {
      inClass = true;
    } else if (c === ":") {
      return i;
    } else if (c === "(") {
      if (hostPlusPort[i + 1] === ":") return i;
      // Past the group's own syntax up to its body: `(?:`, `(?i:`, `(?<name>`.
      const syntax = /^\(\?[A-Za-z-]*:?/.exec(hostPlusPort.slice(i));
      if (syntax) i += syntax[0].length - 1;
    }
  }
  return -1;
}

/**
 * Split a `<host>[:<port>]` regex fragment (a `~` rule's own text, minus any
 * scheme or path around it) into its domain-only prefix and the port
 * pattern (including its own leading `:` or `(`). `portPattern` is `null`
 * when the fragment names no port at all.
 */
export function splitDomainFromPortPattern(hostPlusPort: string): {
  domain: string;
  portPattern: string | null;
} {
  const start = portPatternStart(hostPlusPort);
  if (start === -1) return { domain: hostPlusPort, portPattern: null };
  return {
    domain: hostPlusPort.slice(0, start),
    portPattern: hostPlusPort.slice(start),
  };
}

/**
 * Extract the host-only fragment from a `~` host rule's raw regex, for the
 * resolver's allowlist: a DNS query carries no port, so whatever names a port
 * is dropped here regardless of its shape. Enforcement uses the raw regex
 * directly instead (see haproxy-rules.ts), matched as one expression against
 * the connection, so this function exists only for coredns-config.ts.
 *
 * @throws {Error} if the regex is invalid, it carries a top-level `|`, it
 *   names no port at all (a port is always required), or the host half does
 *   not compile as a regex on its own or holds a character no hostname can
 */
export function splitRawRegexHost(pattern: string): { host: string } {
  const regex = pattern.slice(1);
  try {
    new RegExp(regex);
  } catch (e) {
    throw new Error(`Invalid regex in rule "${pattern}": ${(e as Error).message}`);
  }
  // Over the whole expression: the split cuts at the first ":", leaving the
  // "|" of `a\.com:443|b\.com:443` where a host-half check would not see it.
  checkRawRegexHalf(regex, "expression", pattern, false);

  const { domain, portPattern } = splitDomainFromPortPattern(regex);
  if (portPattern === null) {
    throw new Error(
      `Invalid regex in rule "${pattern}": expected ":" separating the host from a port; a port ` +
        `is always required`,
    );
  }
  let host = domain;
  if (host.startsWith("^")) host = host.slice(1);
  checkRawRegexHalf(host, "host half", pattern, true);

  try {
    new RegExp(host);
  } catch (e) {
    throw new Error(
      `Invalid regex in rule "${pattern}": the host part "${host}" does not compile on its own: ` +
        `${(e as Error).message}`,
    );
  }
  return { host };
}

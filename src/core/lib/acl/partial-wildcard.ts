/**
 * Domain pattern compiler for the `inspect` engine, which allows a wildcard
 * inside a label: `abc*.amazonaws.com`.
 *
 * The shared compiler in wildcard-rules.ts rejects that, requiring a label
 * containing `*` to be exactly `*` or `**`. For the other engines that is only
 * a restriction on how a rule can be phrased. For `inspect` it would be a
 * hazard, because the resolver's scope is generated from these same patterns:
 * a rule unable to say "only names beginning with abc" forces the author to
 * write `*.amazonaws.com` instead, widening what the build is allowed to
 * resolve and therefore what it can leak through a DNS query alone.
 *
 * The wildcard vocabulary is otherwise unchanged, and keeps the same meaning
 * wherever it appears in a label:
 *
 *   `**` — one or more characters, dots included
 *   `*`  — one or more characters, dots excluded
 *   `?`  — a single character, dots excluded
 *
 * Kept separate from wildcard-rules.ts rather than added to it, so widening
 * this grammar cannot change what the `transparent` and `explicit` engines
 * accept.
 */

/** Characters that must be escaped to appear literally in a regex. */
const REGEX_META = /[.+^$()[\]{}|\\]/g;

/** How a wildcard is spelled for one kind of separator. */
interface Vocabulary {
  /** `**` — one or more characters, separator included. */
  across: string;
  /** `*` — one or more characters, separator excluded. */
  within: string;
  /** `?` — a single character, separator excluded. */
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
      // Longest match first: `**` spans the separator, a single `*` does not.
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

/**
 * Convert a domain pattern to a regex string, without anchors or port.
 *
 * @throws {Error} if a label is empty
 */
export function domainToRegexPartial(domain: string): string {
  return domain
    .split(".")
    .map((label) => {
      if (label === "") throw new Error(`Invalid domain "${domain}": empty label`);
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

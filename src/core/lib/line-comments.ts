/**
 * The `#` comment rule for the rule inputs (allowed-*-rules,
 * known-blocked-rules). A comment starts at a `#` that is at the start of a
 * line or preceded by whitespace, and runs to the end of the line.
 */

/**
 * Drop a trailing `#` comment from a single line. The leading whitespace is
 * kept so the tokens before it stay separated. A `#` with no whitespace before
 * it is left in place, for rejectGluedHash to catch once the line is split.
 */
export function stripLineComment(line: string): string {
  return line.replace(/(^|\s)#.*$/, "$1");
}

/**
 * Reject a `#` that survived comment stripping, i.e. one glued to a rule with
 * no space before it. A `#` is never a legitimate part of a rule: it appears
 * in no host or address, a URL fragment is dropped before the request is ever
 * sent, and it is not a regex metacharacter. So a glued `#` is a mistake, a
 * comment written without its leading space or a stray fragment, and reporting
 * it keeps the rule from silently becoming one that matches nothing.
 *
 * `rule` is the single token for a host rule, or the whole line for a URL rule
 * (which is one rule), so the message names exactly what is at fault.
 */
export function rejectGluedHash(rule: string): void {
  if (rule.includes("#")) {
    throw new Error(
      `Invalid rule ${JSON.stringify(rule)}: a "#" starts a comment only with a space ` +
        `before it, and "#" is never part of a host or URL, so a rule cannot contain one.`,
    );
  }
}

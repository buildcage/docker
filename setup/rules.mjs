/**
 * Split a rule string separated by whitespace,
 * preserving whitespace inside `{…}` blocks.
 */
export function splitRules(input) {
  if (!input) return [];
  return (input.match(/(?:\{[^}]*\}|[^\s])+/g) ?? []).filter(Boolean);
}

/**
 * Convert a wildcard domain pattern to a regex string (without anchors).
 *
 * Supported wildcards:
 *   `**` — matches one or more characters including dots
 *   `*`  — matches one or more characters excluding dots
 *   `?`  — matches a single character excluding dots
 *
 * A dot-separated part containing `*` must be exactly `*` or `**`.
 */
export function wildcardToRegex(domain) {
  const parts = domain.split('.');
  const regexParts = parts.map(part => {
    if (part === '**') return '.+';
    if (part === '*') return '[^.]+';
    if (part.includes('*')) {
      throw new Error(`Invalid wildcard in "${domain}": part "${part}" mixes '*' with other characters`);
    }
    // Escape regex meta characters (`?` excluded — it is a wildcard, handled below)
    return part
      .replace(/[.+^$()[\]{}|\\]/g, '\\$&')
      .replace(/\?/g, '[^.]');
  });
  return regexParts.join('\\.');
}

/**
 * Convert a single rule (wildcard or `~`-prefixed regex) to a regex string.
 */
export function convertRule(rule) {
  // Regex rule — strip leading `~` and return as-is
  if (rule.startsWith('~')) {
    return rule.slice(1);
  }

  // Wildcard rule — check for an explicit port suffix
  const portMatch = rule.match(/:(\d+)$/);
  if (portMatch) {
    const port = portMatch[1];
    const domain = rule.slice(0, -portMatch[0].length);
    return `^${wildcardToRegex(domain)}:${port}$`;
  }

  // No port — error
  throw new Error(`Port is required in rule "${rule}" (e.g., "${rule}:443")`);
}

/**
 * Check whether a rule targets an IP address (IPv4 only).
 * Regex rules (`~` prefix) are never considered IP rules.
 */
export function isIPRule(rule) {
  if (rule.startsWith('~')) return false;
  const portMatch = rule.match(/:(\d+)$/);
  const domain = portMatch ? rule.slice(0, -portMatch[0].length) : rule;
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(domain);
}

/**
 * Convert legacy domain + port inputs into regex rules.
 */
export function convertLegacyDomains(domainsInput, portsInput) {
  const domains = domainsInput.split(/[,\s]+/).filter(Boolean);
  const ports = portsInput.split(/[,\s]+/).filter(Boolean);
  if (domains.length === 0) return [];

  const portPattern = ports.length === 1 ? ports[0] : `(${ports.join('|')})`;

  return domains.map(d => `^${wildcardToRegex(d)}:${portPattern}$`);
}

/**
 * Build regex rules from new-style rule input, split into domain and IP rules.
 *
 * @returns {{ domainRules: string[], ipRules: string[] }}
 */
export function buildRules(rulesInput) {
  if (!rulesInput) return { domainRules: [], ipRules: [] };
  const domainRules = [];
  const ipRules = [];
  for (const r of splitRules(rulesInput)) {
    const converted = convertRule(r);
    if (isIPRule(r)) {
      ipRules.push(converted);
    } else {
      domainRules.push(converted);
    }
  }
  return { domainRules, ipRules };
}

/**
 * Build legacy domain rules with deprecation warning.
 *
 * @returns {string[]} Regex rules (domain only)
 */
export function buildLegacyRules({ domainsInput, portsInput, defaultPort, protocol }) {
  if (!domainsInput || !domainsInput.trim()) return [];
  console.warn(
    `⚠ Deprecated: allowed_${protocol.toLowerCase()}_domains / ${protocol.toLowerCase()}_ports inputs are deprecated. ` +
    `Use allowed_${protocol.toLowerCase()}_rules instead.`
  );
  return convertLegacyDomains(domainsInput, portsInput || String(defaultPort));
}

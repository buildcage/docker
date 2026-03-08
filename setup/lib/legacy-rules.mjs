/**
 * Legacy rule conversion for GitHub Actions.
 * New-style rules are passed directly to the container (no conversion needed).
 */

/**
 * Build legacy domain rules with deprecation warning.
 * Returns wildcard-format rules (domain:port).
 *
 * @returns {string[]}
 */
export function buildLegacyRules({ domainsInput, portsInput, defaultPort, protocol }) {
  if (!domainsInput || !domainsInput.trim()) return [];
  console.log(
    `::warning::Deprecated: allowed_${protocol.toLowerCase()}_domains / ${protocol.toLowerCase()}_ports inputs are deprecated. ` +
    `Use allowed_${protocol.toLowerCase()}_rules instead.`
  );
  return convertLegacyDomains(domainsInput, portsInput?.trim() || String(defaultPort));
}

/**
 * Convert legacy domain + port inputs into wildcard-format rules.
 * Each domain is expanded with each port individually.
 *
 * @returns {string[]} Wildcard rules (e.g. ["example.com:443", "example.com:8443"])
 */
export function convertLegacyDomains(domainsInput, portsInput) {
  const domains = domainsInput.split(/[,\s]+/).filter(Boolean);
  const ports = portsInput.split(/[,\s]+/).filter(Boolean);
  if (domains.length === 0) return [];

  const rules = [];
  for (const d of domains) {
    for (const p of ports) {
      rules.push(`${d}:${p}`);
    }
  }
  return rules;
}

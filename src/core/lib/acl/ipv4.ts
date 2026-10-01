/** Decimal octets only: HAProxy reads a leading zero as octal. */

export const OCTET = "(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])";
const PREFIX = "(3[0-2]|[12]?[0-9])";
const IPV4 = `${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}`;

export const OCTET_RE = new RegExp(`^${OCTET}$`);
/** An address or CIDR block, which is what HAProxy's `dst` acl accepts. */
export const IPV4_OR_CIDR = new RegExp(`^${IPV4}(?:/${PREFIX})?$`);
export const IPV4_CIDR = new RegExp(`^${IPV4}/${PREFIX}$`);

/**
 * A wildcard octet stands for any value, so only the literal ones are checked.
 * `*` never spans a dot, so without a `**` there have to be four octets, or the
 * rule could match no address.
 */
export function isIpRuleAddress(host: string): boolean {
  if (!/[*?]/.test(host)) return IPV4_OR_CIDR.test(host);
  const octets = host.split(".");
  if (octets.length > 4 || (octets.length < 4 && !host.includes("**"))) return false;
  return octets.every((octet) => /[*?]/.test(octet) || OCTET_RE.test(octet));
}

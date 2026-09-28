/** Decimal octets only: HAProxy reads a leading zero as octal. */

export const OCTET = "(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])";
const PREFIX = "(3[0-2]|[12]?[0-9])";
const IPV4 = `${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}`;

export const OCTET_RE = new RegExp(`^${OCTET}$`);
/** An address or CIDR block, which is what HAProxy's `dst` acl accepts. */
export const IPV4_OR_CIDR = new RegExp(`^${IPV4}(?:/${PREFIX})?$`);
export const IPV4_CIDR = new RegExp(`^${IPV4}/${PREFIX}$`);

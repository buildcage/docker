/**
 * Compiles buildcage's rule strings into the matchers the `inspect` engine's
 * haproxy.cfg is built from. Pure data: haproxy-config.ts turns the result
 * into config text, and this module knows nothing about that text.
 */

import type { UrlRule } from "./url-rules.ts";
import { domainToRegexPartial, splitRawRegexHost } from "./partial-wildcard.ts";

/** An IPv4 address or CIDR block, which is what HAProxy's `dst` acl accepts. */
const IPV4_OR_CIDR = /^\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?$/;

/**
 * A dotted quad matched against a Host header. Strict about octets: whatever
 * matches is used as the destination unresolved, so nothing that is not an
 * address may pass.
 */
const OCTET = "(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])";
export const HOST_IS_ADDRESS = `^${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}$`;

/**
 * Ranges a resolved name may not point at, refused to stop an allowlisted name
 * resolving to somewhere the proxy can reach but the build cannot -- a cloud
 * metadata endpoint above all. Only never-public ranges; RFC1918 is allowed,
 * since a name pointing at an internal mirror is legitimate. An address named
 * directly in a rule is exempt.
 *
 *   0.0.0.0/8        this host          169.254.0.0/16  link-local (AWS/GCP/Azure IMDS)
 *   127.0.0.0/8      loopback           100.64.0.0/10   CGNAT (Alibaba IMDS)
 *   192.0.0.0/24     IETF (Oracle IMDS) ::1 fe80::/10 fc00::/7  the v6 equivalents
 */
export const INTERNAL_RANGES = [
  "0.0.0.0/8",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "100.64.0.0/10",
  "192.0.0.0/24",
  "::1/128",
  "fe80::/10",
  "fc00::/7",
];

/**
 * How a rule's host half is matched:
 *
 *  - "wildcard": `hostRegex` names the host alone; `port`, if any, is a
 *    literal number matched separately (HAProxy's dst_port ACL).
 *  - "hostPort": a `~` host/tls/ip rule. `hostRegex` is the user's whole
 *    regex, covering host and port together, matched as one expression
 *    against the connection stringified. `port` is always null -- the
 *    pattern's own port coverage replaces it, and a port can never be
 *    matched with a regex through dst_port.
 *  - "hostBareFull": a `~` URL rule's host half. `hostRegex` covers the host
 *    alone (port optional in the pattern), tried against two forms of the
 *    connection: without a port when the connection is on the scheme's
 *    default port, and with the real port otherwise. `port` is always null.
 */
export type HostMatch = "wildcard" | "hostPort" | "hostBareFull";

/** A host/URL rule, matched on host, port, path and (for URL rules) method. */
export interface CompiledRule {
  id: string;
  hostMatch: HostMatch;
  hostRegex: string;
  /** The port the rule names, or null for any port. Only meaningful when `hostMatch` is "wildcard". */
  port: string | null;
  pathRegex: string;
  methods: string[] | null;
  raw: string;
}

/** An IP rule, tunnelled at TCP level without inspection. */
export interface CompiledIpRule {
  id: string;
  /** A literal IPv4 address or CIDR block, or (when `hostMatch` is "hostPort") the whole "address:port" regex. */
  address: string;
  hostMatch: "wildcard" | "hostPort";
  port: string | null;
  raw: string;
}

/** A TLS rule, judged on SNI and passed through undecrypted. */
export interface CompiledTlsRule {
  id: string;
  hostMatch: "wildcard" | "hostPort";
  hostRegex: string;
  port: string | null;
  raw: string;
}

export interface RuleInputs {
  /** Host rules (`host:port` wildcards), any method, any path. */
  httpsRules?: string[];
  httpRules?: string[];
  /** Method + URL rules. */
  urlRules?: UrlRule[];
  /** `address:port`, tunnelled without inspection. */
  ipRules?: string[];
  /** `host:port` wildcards, SNI-judged and passed through undecrypted. */
  tlsRules?: string[];
}

export interface CompiledRuleSet {
  https: CompiledRule[];
  http: CompiledRule[];
  ip: CompiledIpRule[];
  tls: CompiledTlsRule[];
  /** Rules that could not be honoured in full, for the caller to surface. */
  warnings: string[];
}

/**
 * Split a compiled `host:port` authority into a name matcher and the port.
 *
 * The port is matched against the connection (`dst_port`), not the Host header:
 * a header omits a default port, so matching it there would make `host:9443`
 * also permit `host` on 443.
 */
function splitHostAndPort(hostRegexWithPort: string): { hostRegex: string; port: string | null } {
  const colonIndex = hostRegexWithPort.lastIndexOf(":");
  const port = hostRegexWithPort.slice(colonIndex + 1);
  return {
    hostRegex: `^${hostRegexWithPort.slice(0, colonIndex)}$`,
    // url-rules.ts spells "any port" as [0-9]+ in the authority it compiles.
    port: port === "[0-9]+" ? null : port,
  };
}

/** Turn a `host:port` wildcard, or a `~` regex, into a host matcher and the port it names. */
function hostRuleToMatcher(pattern: string): {
  hostMatch: "wildcard" | "hostPort";
  hostRegex: string;
  port: string | null;
} {
  if (pattern.startsWith("~")) {
    // Validates: the regex compiles, it names a port, and the host half
    // compiles alone -- the host half itself is only needed by
    // coredns-config.ts, but the checks apply here just the same.
    splitRawRegexHost(pattern);
    return { hostMatch: "hostPort", hostRegex: pattern.slice(1), port: null };
  }
  const colonIndex = pattern.lastIndexOf(":");
  if (colonIndex === -1) {
    throw new Error(`Invalid rule "${pattern}": missing port`);
  }
  const portText = pattern.slice(colonIndex + 1);
  const hostPattern = pattern.slice(0, colonIndex);
  if (!/^(?:\d+|\*)$/.test(portText)) {
    throw new Error(`Invalid port in rule "${pattern}": "${portText}"`);
  }
  return {
    hostMatch: "wildcard",
    hostRegex: `^${domainToRegexPartial(hostPattern)}$`,
    port: portText === "*" ? null : portText,
  };
}

function compileSchemeRules(
  hostRules: string[] | undefined,
  urlRules: UrlRule[] | undefined,
  scheme: "https" | "http",
): CompiledRule[] {
  const out: CompiledRule[] = [];
  for (const pattern of hostRules ?? []) {
    // A host rule permits any path.
    out.push({
      id: "",
      ...hostRuleToMatcher(pattern),
      pathRegex: "^/",
      methods: null,
      raw: pattern,
    });
  }
  for (const rule of urlRules ?? []) {
    if (rule.scheme !== scheme) continue;
    if (rule.isRegex) {
      out.push({
        id: "",
        hostMatch: "hostBareFull",
        hostRegex: rule.hostRegex,
        port: null,
        pathRegex: rule.pathRegex,
        methods: rule.methods,
        raw: rule.raw,
      });
      continue;
    }
    out.push({
      id: "",
      hostMatch: "wildcard",
      // authorityRegex is `^<hostRegex>:<port>$`.
      ...splitHostAndPort(rule.authorityRegex.slice(1, -1)),
      pathRegex: rule.pathRegex,
      methods: rule.methods,
      raw: rule.raw,
    });
  }
  out.forEach((rule, i) => {
    rule.id = `${scheme === "https" ? "s" : "p"}${i}`;
  });
  return out;
}

function compileIpRules(rules: string[] | undefined, warnings: string[]): CompiledIpRule[] {
  const out: CompiledIpRule[] = [];
  (rules ?? []).forEach((rule, index) => {
    if (rule.startsWith("~")) {
      // Validates: the regex compiles and it names a port -- see
      // hostRuleToMatcher for why this is checked here too.
      splitRawRegexHost(rule);
      out.push({
        id: `ip${index}`,
        address: rule.slice(1),
        hostMatch: "hostPort",
        port: null,
        raw: rule,
      });
      return;
    }
    const colonIndex = rule.lastIndexOf(":");
    if (colonIndex === -1) {
      warnings.push(`IP rule ${JSON.stringify(rule)} has no port. It is ignored.`);
      return;
    }
    const address = rule.slice(0, colonIndex);
    const port = rule.slice(colonIndex + 1);
    if (!IPV4_OR_CIDR.test(address)) {
      warnings.push(
        `IP rule ${JSON.stringify(rule)} is not an address or CIDR block, which is all that can be ` +
          `tunnelled without inspection. It is ignored.`,
      );
      return;
    }
    out.push({
      id: `ip${index}`,
      address,
      hostMatch: "wildcard",
      port: port === "*" ? null : port,
      raw: rule,
    });
  });
  return out;
}

/**
 * Compile every rule input into matchers, collecting warnings for rules that
 * cannot be honoured in full.
 *
 * @throws {Error} if a host rule has invalid wildcard syntax
 */
export function compileRuleSet(inputs: RuleInputs): CompiledRuleSet {
  const warnings: string[] = [];
  return {
    https: compileSchemeRules(inputs.httpsRules, inputs.urlRules, "https"),
    http: compileSchemeRules(inputs.httpRules, inputs.urlRules, "http"),
    ip: compileIpRules(inputs.ipRules, warnings),
    tls: (inputs.tlsRules ?? []).map((pattern, index) => ({
      id: `tls${index}`,
      ...hostRuleToMatcher(pattern),
      raw: pattern,
    })),
    warnings,
  };
}

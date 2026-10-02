/**
 * Compiles buildcage's rule strings into the matchers both engines' haproxy.cfg
 * and the Corefile are built from. Pure data: the generators turn the result
 * into config text, and this module knows nothing about that text.
 */

import { IPV4_OR_CIDR, OCTET, isIpRuleAddress } from "./ipv4.ts";
import {
  anchorRawRegex,
  checkPort,
  domainToRegexPartial,
  splitRawRegexHost,
} from "./partial-wildcard.ts";
import type { UrlRule } from "./url-rules.ts";
import { convertRule } from "./wildcard-rules.ts";

/**
 * A dotted quad matched against a Host header. Strict about octets: whatever
 * matches is used as the destination unresolved, so nothing that is not an
 * address may pass.
 */
export const HOST_IS_ADDRESS = `^${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}$`;

/**
 * Ranges a resolved name may not point at, refused to stop an allowlisted name
 * resolving to somewhere the proxy can reach but the build cannot, a cloud
 * metadata endpoint above all. Only never-public ranges; RFC1918 (and its v6
 * equivalent, fc00::/7 ULA) is allowed, since a name pointing at an internal
 * mirror is legitimate. Under `inspect` an address named directly in a rule
 * is exempt.
 *
 * A resolution produces an IPv4 address only, enforced by `dns-accept-family
 * ipv4` in the generated global section. ::1 and fe80::/10 are kept anyway, at
 * zero cost, in case that changes; fc00::/7 is deliberately absent rather than
 * kept the same way, since (unlike loopback/link-local) it is never-public but
 * not never-legitimate.
 *
 *   0.0.0.0/8        this host          169.254.0.0/16    link-local (AWS/GCP/Azure IMDS)
 *   127.0.0.0/8      loopback           100.64.0.0/10     CGNAT (Alibaba IMDS)
 *   192.0.0.0/24     IETF (Oracle IMDS) 168.63.129.16/32  Azure WireServer
 *   ::1/128 fe80::/10  the v6 loopback/link-local equivalents
 */
export const INTERNAL_RANGES = [
  "0.0.0.0/8",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "100.64.0.0/10",
  "192.0.0.0/24",
  "168.63.129.16/32",
  "::1/128",
  "fe80::/10",
];

/**
 * How a rule's host half is matched:
 *
 *  - "wildcard": `hostRegex` names the host alone; `port`, if any, is a
 *    literal number matched separately (HAProxy's dst_port ACL).
 *  - "hostPort": a `~` host/tls/ip rule. `hostRegex` is the user's whole
 *    regex, covering host and port together, matched as one expression
 *    against the connection stringified. `port` is always null, since the
 *    pattern's own port coverage replaces it and a port can never be matched
 *    with a regex through dst_port.
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
  /** The port the rule names, or null for any port. */
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
  /**
   * Every name a rule allows, as a host-only regex with no anchors,
   * deduplicated: what the resolver's allowlist is generated from; see
   * coredns-config.ts. IP rules are absent, an address being reached without
   * a name.
   */
  resolverHosts: string[];
}

/**
 * Split a `host:port` rule at its port separator.
 *
 * @throws {Error} if the rule names no port, names one checkPort refuses, or
 *   leaves a `:` in the host half
 */
function splitHostRule(pattern: string): { host: string; port: string } {
  const colonIndex = pattern.lastIndexOf(":");
  if (colonIndex === -1) {
    throw new Error(`Invalid rule "${pattern}": missing port`);
  }
  const port = pattern.slice(colonIndex + 1);
  checkPort(port, pattern);
  const host = pattern.slice(0, colonIndex);
  if (host.includes(":")) {
    throw new Error(
      `Invalid host in rule "${pattern}": "${host}" holds a ":", so the one this rule was split ` +
        `at is not its port separator. An IPv6 address is not supported here.`,
    );
  }
  return { host, port };
}

/**
 * A host rule's name half as a regex, with no port and no anchors.
 *
 * The resolver's allowlist is built from these, a DNS query having no port to
 * match against, and the proxy's own matcher is the same expression anchored.
 * One derivation, so the two can never accept different names.
 */
function hostOnlyRegexOfRule(pattern: string): string {
  if (pattern.startsWith("~")) return splitRawRegexHost(pattern).host;
  return domainToRegexPartial(splitHostRule(pattern).host);
}

/**
 * The same for a URL rule, whose host half url-rules.ts has already compiled
 * into `authorityRegex`: `^<host>$` for a `~` rule, `^<host>:<port>$`
 * otherwise.
 */
function hostOnlyRegexOfUrlRule(rule: UrlRule): string {
  const authority = rule.authorityRegex.slice(1, -1);
  return rule.isRegex ? authority : authority.slice(0, authority.lastIndexOf(":"));
}

/**
 * A URL rule's name matcher and the port it names.
 *
 * The port is matched against the connection (`dst_port`), not the Host header:
 * a header omits a default port, so matching it there would make `host:9443`
 * also permit `host` on 443.
 */
function urlRuleToMatcher(rule: UrlRule): { hostRegex: string; port: string | null } {
  const hostOnly = hostOnlyRegexOfUrlRule(rule);
  const port = rule.authorityRegex.slice(1, -1).slice(hostOnly.length + 1);
  return {
    hostRegex: `^${hostOnly}$`,
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
    // compiles alone.
    splitRawRegexHost(pattern);
    return { hostMatch: "hostPort", hostRegex: anchorRawRegex(pattern.slice(1)), port: null };
  }
  const { port } = splitHostRule(pattern);
  return {
    hostMatch: "wildcard",
    hostRegex: `^${hostOnlyRegexOfRule(pattern)}$`,
    port: port === "*" ? null : port,
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
    if (!rule.schemes.includes(scheme)) continue;
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
      ...urlRuleToMatcher(rule),
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

/**
 * @throws {Error} if a rule names no port, names one checkPort refuses, or is
 *   not an address, CIDR block or address wildcard
 */
function compileIpRules(rules: string[] | undefined): CompiledIpRule[] {
  const out: CompiledIpRule[] = [];
  (rules ?? []).forEach((rule, index) => {
    if (rule.startsWith("~")) {
      // Validates: the regex compiles and it names a port. See
      // hostRuleToMatcher for why this is checked here too.
      splitRawRegexHost(rule);
      out.push({
        id: `ip${index}`,
        address: anchorRawRegex(rule.slice(1)),
        hostMatch: "hostPort",
        port: null,
        raw: rule,
      });
      return;
    }
    const colonIndex = rule.lastIndexOf(":");
    if (colonIndex === -1) {
      throw new Error(`Invalid rule "${rule}": missing port`);
    }
    const address = rule.slice(0, colonIndex);
    const port = rule.slice(colonIndex + 1);
    if (!isIpRuleAddress(address)) {
      throw new Error(
        `Invalid address in rule "${rule}": not an address, CIDR block or address wildcard, ` +
          `which is all that can be tunnelled without inspection`,
      );
    }
    checkPort(port, rule);
    if (!IPV4_OR_CIDR.test(address)) {
      // `dst` takes no wildcard, so the address is matched as text the way
      // the `universal` engine matches every IP rule.
      out.push({
        id: `ip${index}`,
        address: convertRule(rule),
        hostMatch: "hostPort",
        port: null,
        raw: rule,
      });
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
 * Compile every rule input into matchers.
 *
 * @throws {Error} if a rule is malformed
 */
export function compileRuleSet(inputs: RuleInputs): CompiledRuleSet {
  return {
    https: compileSchemeRules(inputs.httpsRules, inputs.urlRules, "https"),
    http: compileSchemeRules(inputs.httpRules, inputs.urlRules, "http"),
    ip: compileIpRules(inputs.ipRules),
    tls: (inputs.tlsRules ?? []).map((pattern, index) => ({
      id: `tls${index}`,
      ...hostRuleToMatcher(pattern),
      raw: pattern,
    })),
    resolverHosts: resolverHosts(inputs),
  };
}

/** In input order and without repeats; see CompiledRuleSet.resolverHosts. */
function resolverHosts(inputs: RuleInputs): string[] {
  const hosts: string[] = [];
  const add = (regex: string) => {
    if (!hosts.includes(regex)) hosts.push(regex);
  };
  for (const pattern of inputs.httpsRules ?? []) add(hostOnlyRegexOfRule(pattern));
  for (const pattern of inputs.httpRules ?? []) add(hostOnlyRegexOfRule(pattern));
  // A TLS rule's name has to resolve too, even though it is not inspected.
  for (const pattern of inputs.tlsRules ?? []) add(hostOnlyRegexOfRule(pattern));
  for (const rule of inputs.urlRules ?? []) add(hostOnlyRegexOfUrlRule(rule));
  return hosts;
}

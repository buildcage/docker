/**
 * Compiles buildcage's rule strings into the matchers the `inspect` engine's
 * haproxy.cfg is built from. Pure data: haproxy-config.ts turns the result
 * into config text, and this module knows nothing about that text.
 */

import type { UrlRule } from "./url-rules.ts";
import { domainToRegexPartial } from "./partial-wildcard.ts";

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

/** A host/URL rule, matched on host, port, path and (for URL rules) method. */
export interface CompiledRule {
  id: string;
  /** Matches the name alone; the port is matched separately. */
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
  address: string;
  port: string | null;
  raw: string;
}

/** A TLS rule, judged on SNI and passed through undecrypted. */
export interface CompiledTlsRule {
  id: string;
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

/** Turn a `host:port` wildcard into a host matcher and the port it names. */
function hostRuleToMatcher(pattern: string): { hostRegex: string; port: string | null } {
  const colonIndex = pattern.lastIndexOf(":");
  const portText = colonIndex === -1 ? "*" : pattern.slice(colonIndex + 1);
  const hostPattern = colonIndex === -1 ? pattern : pattern.slice(0, colonIndex);
  return {
    hostRegex: `^${domainToRegexPartial(hostPattern)}$`,
    port: portText === "*" ? null : portText,
  };
}

function compileSchemeRules(
  hostRules: string[] | undefined,
  urlRules: UrlRule[] | undefined,
  scheme: "https" | "http",
  warnings: string[],
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
    if (!rule.authorityRegex || !rule.pathRegex) {
      warnings.push(
        `Rule ${JSON.stringify(rule.raw)} has no derivable host, so its host and path cannot be ` +
          `matched separately. Add a matching allowed_https_rules entry for the host it targets.`,
      );
      continue;
    }
    out.push({
      id: "",
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
    out.push({ id: `ip${index}`, address, port: port === "*" ? null : port, raw: rule });
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
    https: compileSchemeRules(inputs.httpsRules, inputs.urlRules, "https", warnings),
    http: compileSchemeRules(inputs.httpRules, inputs.urlRules, "http", warnings),
    ip: compileIpRules(inputs.ipRules, warnings),
    tls: (inputs.tlsRules ?? []).map((pattern, index) => ({
      id: `tls${index}`,
      ...hostRuleToMatcher(pattern),
      raw: pattern,
    })),
    warnings,
  };
}

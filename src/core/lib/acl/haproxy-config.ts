/**
 * haproxy.cfg generator for the `inspect` engine.
 *
 * The config it emits relies on four HAProxy behaviours:
 *
 *  1. One listener takes both TLS and plaintext, told apart by the first bytes
 *     (`req.ssl_hello_type`), so no port is declared in advance and `audit`
 *     records everything unconfigured.
 *  2. The requested name is resolved here, only once the rules below already
 *     allowed the request, and connected to (`do-resolve` then `set-dst`), so
 *     a forged Host or doctored /etc/hosts cannot pick the destination, and a
 *     name a request would be denied for never triggers a real DNS query.
 *     This is the only place a name becomes a real address: the build's own
 *     resolver (CoreDNS) never gives one out; see coredns-config.ts.
 *  3. `..` in the path is resolved before the rules see it (`normalize-uri`).
 *  4. A leaf certificate is generated per SNI, so a refused destination is
 *     never contacted, and the origin certificate is verified on the backend
 *     connection, which is only reached once a request is allowed.
 */

import {
  compileRuleSet,
  HOST_IS_ADDRESS,
  INTERNAL_RANGES,
  type CompiledRule,
  type RuleInputs,
} from "./haproxy-rules.ts";
import { DEFAULT_PORT } from "./url-rules.ts";

export interface HaproxyConfigOptions extends RuleInputs {
  /** `audit` records without enforcing, so nothing may be refused. */
  mode?: "restrict" | "audit";
  /** Where redirected traffic arrives. */
  listenPort?: number;
  /**
   * Upstream DNS servers a name is resolved against, once a request has
   * already passed the rule ACLs below. Not the resolver the build itself
   * uses -- CoreDNS never gives out a real answer; see coredns-config.ts.
   */
  resolverAddress?: string[];
  /**
   * Resolve through the container's own /etc/resolv.conf rather than named
   * upstreams, so a name resolves against the runner's own DNS. Ignored when
   * resolverAddress names upstreams of its own.
   */
  useResolvConf?: boolean;
  /**
   * The proxy's own address (the CoreDNS/gateway address), excluded from a
   * resolved destination like every other internal range; see
   * INTERNAL_RANGES.
   */
  proxyAddress?: string;
  /**
   * Pattern file of the runner's own addresses, added to the
   * internal-destination guard. A file because HAProxy truncates an acl line
   * past MAX_LINE_ARGS silently and the address count is environment-dependent.
   * Omitted, no such acl is emitted.
   */
  hostAddressFile?: string;
  caSignFile?: string;
  defaultCertFile?: string;
  systemCaFile?: string;
}

const DEFAULTS = {
  listenPort: 10024,
  caSignFile: "/etc/haproxy/ca.pem",
  defaultCertFile: "/etc/haproxy/default.pem",
  systemCaFile: "/etc/ssl/certs/ca-certificates.crt",
};

const TLS_STAGE_PORT = 10025;
const PLAIN_STAGE_PORT = 10026;

/**
 * `host_only` strips the port a Host header carries; chained onto it here so
 * every host match, resolution and certificate check also treats a trailing
 * dot (`example.com.`, a valid FQDN form) as the same name it denotes in DNS.
 */
const HOST_ONLY = "host_only,regsub(\\.$,)";

export interface GeneratedHaproxyConfig {
  config: string;
  warnings: string[];
}

/**
 * Escape a rule-derived value for HAProxy's config word parser.
 *
 * Unquoted, the parser drops everything from a `#` to the end of the line, so a
 * rule carrying one would silently shorten the ACL it belongs to rather than
 * fail: `^/pkg#frag$` reaches the regex engine as `^/pkg`, allowing every path
 * that merely starts with `/pkg`. A quote opens a quoted string and breaks the
 * config outright.
 *
 * Only ` `, `#`, `\`, `'` and `"` are folded by the parser, and `\` is folded
 * only before one of those: `\.` and `$` arrive at the regex engine as written,
 * which is why every backslash is doubled here. One pass over the original
 * string, so an escape this adds is never escaped again.
 */
export function escapeForHaproxy(value: string): string {
  return value.replace(/[\\#'" ]/g, "\\$&");
}

/**
 * A compiled pattern as the cheapest HAProxy match that accepts exactly it.
 *
 * Most rules name a literal host and a literal path or path prefix, which
 * compile to an anchored regex that only ever matches one string or one
 * prefix. `-m str` and `-m beg` decide those without entering the regex
 * engine, and the rules are evaluated once per rule per request.
 *
 * Everything else, `~` rules and wildcards included, stays `-m reg`. A pattern
 * is only narrowed when every character between the anchors is literal, so a
 * regex metacharacter anywhere sends it down the regex path untouched.
 */
interface Matcher {
  /** `-m str`, `-m beg` or `-m reg`. */
  op: string;
  /** The pattern as that operator reads it, before config escaping. */
  pattern: string;
}

/**
 * Characters that mean themselves to both the regex engine and `-m str`.
 *
 * `\.` is the one escape a compiled pattern carries, and a bare `.` is a
 * wildcard. Every regex metacharacter is absent, `+` included: a `~` rule
 * carries the author's own regex, where `/a+` means one or more `a`.
 */
const LITERAL_BODY = /^(?:[A-Za-z0-9_~:@%\-/]|\\\.)*$/;

/** Undo the one escape, now that the pattern is no longer read as a regex. */
function unescape(body: string): string {
  return body.replace(/\\\./g, ".");
}

/** How to match a rule's host, which arrives lowercased in txn.host. */
function hostMatcher(hostRegex: string): Matcher {
  const body = /^\^(.+)\$$/.exec(hostRegex)?.[1];
  // A name is case-insensitive, and txn.host is lowercased once per request,
  // so the pattern has to be lowercase for -m str to agree with -m reg -i.
  return body !== undefined && LITERAL_BODY.test(body)
    ? { op: "-m str", pattern: unescape(body).toLowerCase() }
    : { op: "-m reg -i", pattern: hostRegex };
}

/**
 * How to match a rule's path, which is matched case-sensitively as sent.
 *
 * `^lit$` accepts one path and `^lit.*$` accepts a prefix, as does `^lit` with
 * no end anchor, which is what a rule permitting any path compiles to (`^/`).
 */
function pathMatcher(pathRegex: string): Matcher {
  const asRegex = { op: "-m reg", pattern: pathRegex };
  if (!pathRegex.startsWith("^")) return asRegex;

  let body = pathRegex.slice(1);
  let op = "-m beg";
  if (body.endsWith("$")) {
    body = body.slice(0, -1);
    op = "-m str";
    if (body.endsWith(".*")) {
      body = body.slice(0, -2);
      op = "-m beg";
    }
  }
  // A compiled path always starts with its leading slash. Requiring it keeps
  // an empty pattern, which the config parser could not read, out of the
  // narrowed forms.
  if (!body.startsWith("/") || !LITERAL_BODY.test(body)) return asRegex;
  return { op, pattern: unescape(body) };
}

/**
 * Whether this scheme's block refuses every request outright.
 *
 * Its deny carries no condition, so HAProxy treats it as final and skips every
 * http-request rule after it in the same frontend. Nothing may be emitted
 * below it.
 */
function deniesEverything(rules: CompiledRule[], mode: string): boolean {
  return mode !== "audit" && rules.length === 0;
}

/** Emit the rule ACLs and the single deny that enforces them. */
function ruleBlock(rules: CompiledRule[], mode: string, scheme: "https" | "http"): string[] {
  const lines: string[] = [];
  if (mode === "audit") {
    lines.push("    # audit records without enforcing, so nothing is refused here.", "");
    return lines;
  }
  if (deniesEverything(rules, mode)) {
    lines.push(
      "    # No rules for this scheme, so nothing is permitted.",
      "    http-request deny",
      "",
    );
    return lines;
  }

  if (rules.some((r) => r.hostMatch === "hostPort")) {
    // A ~ rule's own regex covers host and port together, so hdr(host) is
    // stringified with the real port once here for every such rule to match.
    lines.push(`    http-request set-var-fmt(txn.host_port) %[hdr(host),${HOST_ONLY}]:%[dst_port]`);
  }
  if (rules.some((r) => r.hostMatch === "hostBareFull")) {
    // A ~ URL rule's port is optional, exactly as in a literal URL: tried
    // without a port on the scheme's own default, and with the real port
    // otherwise -- see haproxy-rules.ts's HostMatch doc comment.
    lines.push(
      `    acl is_default_port dst_port ${DEFAULT_PORT[scheme]}`,
      `    http-request set-var(txn.host_bare) hdr(host),${HOST_ONLY}`,
      `    http-request set-var-fmt(txn.host_full) %[hdr(host),${HOST_ONLY}]:%[dst_port]`,
    );
  }

  if (rules.some((r) => r.hostMatch === "wildcard")) {
    // One fetch and one regsub for the request, rather than one per rule.
    lines.push(`    http-request set-var(txn.host) hdr(host),lower,${HOST_ONLY}`);
  }

  // Rules naming the same host share one acl, so the name is matched once
  // however many paths or methods are allowed on it.
  const aclForHost = new Map<string, string>();
  const hostAclOf = new Map<string, string>();

  for (const rule of rules) {
    const hostRegex = escapeForHaproxy(rule.hostRegex);
    lines.push(`    # ${rule.raw}`);
    if (rule.hostMatch === "hostPort") {
      lines.push(`    acl ${rule.id}_host var(txn.host_port) -m reg -i ${hostRegex}`);
    } else if (rule.hostMatch === "hostBareFull") {
      lines.push(
        `    http-request set-var(txn.${rule.id}_ok) bool(false)`,
        `    http-request set-var(txn.${rule.id}_ok) bool(true) if is_default_port ` +
          `{ var(txn.host_bare) -m reg -i ${hostRegex} }`,
        `    http-request set-var(txn.${rule.id}_ok) bool(true) if ` +
          `{ var(txn.host_full) -m reg -i ${hostRegex} }`,
        `    acl ${rule.id}_host var(txn.${rule.id}_ok) -m bool`,
      );
    } else {
      const host = hostMatcher(rule.hostRegex);
      const shared = aclForHost.get(`${host.op} ${host.pattern}`);
      if (shared === undefined) {
        aclForHost.set(`${host.op} ${host.pattern}`, `${rule.id}_host`);
        lines.push(
          `    acl ${rule.id}_host var(txn.host) ${host.op} ${escapeForHaproxy(host.pattern)}`,
        );
      }
      hostAclOf.set(rule.id, shared ?? `${rule.id}_host`);
      if (rule.port) {
        lines.push(`    acl ${rule.id}_port dst_port ${rule.port}`);
      }
    }
    const path = pathMatcher(rule.pathRegex);
    lines.push(`    acl ${rule.id}_path path ${path.op} ${escapeForHaproxy(path.pattern)}`);
    if (rule.methods) {
      lines.push(`    acl ${rule.id}_method method ${rule.methods.join(" ")}`);
    }
  }
  lines.push("");
  // Named acls are referenced bare; braces are for anonymous expressions.
  const clauses = rules.map(
    (r) =>
      `${hostAclOf.get(r.id) ?? `${r.id}_host`}${r.port ? ` ${r.id}_port` : ""} ${r.id}_path` +
      `${r.methods ? ` ${r.id}_method` : ""}`,
  );
  // One line per rule, not one `or` chain: the parser truncates a line after 64
  // words and calls that fatal, which would cap the rule set at 12.
  lines.push("    http-request set-var(txn.allowed) bool(false)");
  for (const clause of clauses) {
    // The flag comes first so that once a rule has allowed the request, every
    // later rule costs one variable read instead of its own matching.
    lines.push(
      `    http-request set-var(txn.allowed) bool(true) if ` +
        `!{ var(txn.allowed) -m bool } ${clause}`,
    );
  }
  // One deny, negated against every rule: a request matching none is refused.
  lines.push("    http-request deny unless { var(txn.allowed) -m bool }");
  lines.push("");
  return lines;
}

/**
 * Generate a haproxy.cfg from buildcage's rules.
 *
 * @throws {Error} if a host rule has invalid wildcard syntax, or if a resolver
 *   is configured without proxyAddress
 */
export function generateHaproxyConfig(options: HaproxyConfigOptions = {}): GeneratedHaproxyConfig {
  const opts = { ...DEFAULTS, ...options };
  const mode = opts.mode ?? "restrict";
  const {
    https: httpsRules,
    http: httpRules,
    ip: ipRules,
    tls: tlsHosts,
    warnings,
  } = compileRuleSet(options);

  const resolvers = opts.resolverAddress ?? [];
  const useResolvConf = resolvers.length === 0 && opts.useResolvConf === true;
  // Every block below reads this rather than resolvers.length: one left behind
  // would drop do-resolve on the resolv.conf path alone, sending the request
  // wherever the client's own address said.
  const hasResolver = resolvers.length > 0 || useResolvConf;
  // Required together, not just individually optional: without proxyAddress
  // here, a name do-resolve sends back to the proxy's own gateway would not
  // be caught by the internal-address guard below, silently rather than
  // loudly. This must fail closed instead of falling through.
  if (hasResolver && !opts.proxyAddress) {
    throw new Error("proxyAddress is required whenever a resolver is configured");
  }
  // The proxy's own address, not the upstream(s) a name is resolved against:
  // see the resolverAddress/proxyAddress doc comments above.
  const dstInternalAddrs = [...INTERNAL_RANGES, ...(opts.proxyAddress ? [opts.proxyAddress] : [])];
  // Repeating an acl name ORs it with the first declaration, leaving the inline
  // list above untouched.
  const hostAddrAcl = (name: string, expr: string): string[] =>
    opts.hostAddressFile ? [`    acl ${name} ${expr} -m ip -f ${opts.hostAddressFile}`] : [];

  const l: string[] = [];
  l.push(
    "# Generated by buildcage. Do not edit.",
    "",
    "global",
    // 16384 covers the longest request head haproxy accepts (tune.bufsize -
    // tune.maxrewrite). At the default of 1024 a long URL cuts the line, and a
    // cut line matches nothing at all, taking its event out of the report.
    // `len` must precede `format`, or the config is rejected.
    "    log stdout len 16384 format raw local0",
    // This process parses traffic the workload controls, so it must not be root.
    "    user haproxy",
    "    group haproxy",
    // Left to its default this follows the runner's own IPv6 route. The ipv4
    // on each do-resolve below does not constrain the query; this does.
    "    dns-accept-family ipv4",
    "    # normalize-uri is still marked experimental upstream.",
    "    expose-experimental-directives",
    "    tune.ssl.default-dh-param 2048",
    "",
    "defaults",
    "    log global",
    "    timeout connect 5s",
    "    timeout client 30s",
    "    timeout server 30s",
    "",
    // A unix socket rather than a port, so the readiness check reaching it
    // never depends on what init-iptables allows.
    "# Readiness only, for s6-notifyoncheck. Not reachable from the network.",
    "frontend health",
    "    bind /var/run/haproxy-health.sock mode 666",
    "    mode http",
    "    no log",
    "    monitor-uri /health",
    "",
  );

  if (hasResolver) {
    l.push(
      "# Real resolution happens once a request has already passed the rule",
      "# ACLs below; the build's own resolver (CoreDNS) never gives out a real",
      "# answer, so this is the only place a name becomes an address.",
      "resolvers buildcage",
      ...(useResolvConf
        ? ["    parse-resolv-conf"]
        : resolvers.map((addr, i) => `    nameserver ns${i + 1} ${addr}:53`)),
      // The only hold do-resolve reads, and it ignores the record's own TTL,
      // so it is also how long a rotated address keeps being dialled. A minute
      // is about the TTL of the hosts a build talks to.
      "    hold valid 60s",
      // One query more than the default, a second apart. On the passthrough
      // path they share detect's 5s inspect-delay with the wait for the
      // ClientHello.
      "    resolve_retries 4",
      "    timeout retry 1s",
      // The 512-byte default truncates an answer carrying many records, and a
      // truncated answer resolves nothing.
      "    accepted_payload_size 8192",
      "",
    );
  }

  // --- stage 1: classify ----------------------------------------------------
  const hasPassthrough = ipRules.length > 0 || tlsHosts.length > 0;
  l.push(
    "# One listener for everything redirected here. The first bytes say whether",
    "# this is a handshake or a plain request, so no port has to be declared as",
    "# one or the other in advance.",
    "frontend detect",
    `    bind *:${opts.listenPort}`,
    "    mode tcp",
    "    tcp-request inspect-delay 5s",
    "",
  );
  if (hasPassthrough) {
    l.push(
      // req.ssl_sni is attacker-controlled; reduced to a safe charset for logging.
      "    # Captured now, since the request buffer is gone by log time.",
      "    tcp-request content set-var(txn.sni) req.ssl_sni,regsub([^A-Za-z0-9._-],_,g)",
    );
    if (ipRules.some((rule) => rule.hostMatch === "hostPort")) {
      // dst is IP-typed; a ~ rule's own regex covers address and port
      // together, so dst is stringified with the real port to match it.
      l.push("    tcp-request content set-var-fmt(txn.dst_str) %[dst]:%[dst_port]");
    }
    if (tlsHosts.some((host) => host.hostMatch === "hostPort")) {
      l.push("    tcp-request content set-var-fmt(txn.sni_port) %[req.ssl_sni]:%[dst_port]");
    }
    l.push("", "    # Passed through untouched: judged before anything is decrypted.");
    for (const rule of ipRules) {
      l.push(`    # ${rule.raw}`);
      l.push(
        rule.hostMatch === "hostPort"
          ? `    acl ${rule.id}_dst var(txn.dst_str) -m reg ${escapeForHaproxy(rule.address)}`
          : `    acl ${rule.id}_dst dst ${rule.address}`,
      );
      if (rule.port) l.push(`    acl ${rule.id}_port dst_port ${rule.port}`);
    }
    for (const host of tlsHosts) {
      l.push(`    # ${host.raw}`);
      l.push(
        host.hostMatch === "hostPort"
          ? `    acl ${host.id}_sni var(txn.sni_port) -m reg -i ${escapeForHaproxy(host.hostRegex)}`
          : `    acl ${host.id}_sni req.ssl_sni -m reg -i ${escapeForHaproxy(host.hostRegex)}`,
      );
      if (host.port) l.push(`    acl ${host.id}_port dst_port ${host.port}`);
    }
    const conds = [
      ...ipRules.map((r) => `${r.id}_dst${r.port ? ` ${r.id}_port` : ""}`),
      ...tlsHosts.map((h) => `${h.id}_sni${h.port ? ` ${h.id}_port` : ""}`),
    ];

    // A passthrough is never decrypted and so has no request line; the name,
    // destination and byte count are logged here, its only record. Flagged
    // before the rules below reject, so a refused passthrough is logged too.
    l.push(
      "",
      // One line per rule, for the same word-limit reason as ruleBlock's deny.
      ...conds.map((cond) => `    tcp-request content set-var(txn.pass) int(1) if ${cond}`),
      "    tcp-request content set-var(txn.proto) str(tls) if { req.ssl_hello_type 1 }",
      "    tcp-request content set-var(txn.proto) str(tcp) unless { req.ssl_hello_type 1 }",
    );

    if (tlsHosts.length > 0 && hasResolver) {
      // Resolve the SNI ourselves and connect there, as for an inspected
      // request: an SNI is not a destination, so a ClientHello with an allowed
      // name must not become a tunnel to an address of the build's choosing.
      // The flag variable is needed because HAProxy conditions have no
      // grouping: `a or b !c` reads as `a or (b and !c)`.
      l.push("");
      for (const host of tlsHosts) {
        // Ports scope a tls rule (see the ip0/tls0 comment above): without
        // the port ACL here too, an SNI matching a port-scoped rule on a
        // *different* port would still set txn.tlsrule, triggering an early
        // do-resolve/set-dst that overwrites the connection's destination
        // before the inspected path ever sees it, even though txn.pass
        // (gated on sni+port together) correctly never fires for it.
        l.push(
          `    tcp-request content set-var(txn.tlsrule) int(1) if ${host.id}_sni${host.port ? ` ${host.id}_port` : ""}`,
        );
      }
      l.push(
        "    tcp-request content do-resolve(txn.dst,buildcage,ipv4) req.ssl_sni,lower " +
          "if { var(txn.tlsrule) -m found }",
        "    tcp-request content set-var(txn.reason) str(dns-failed) " +
          "if { var(txn.tlsrule) -m found } !{ var(txn.dst) -m found }",
        // Falling through would connect to the address the client chose.
        "    tcp-request content reject if { var(txn.tlsrule) -m found } " +
          "!{ var(txn.dst) -m found }",
        // Before the internal-destination check below, not after, for the
        // same reason and with the same log-format consequence as the
        // inspected path; see the matching comment in stage() below.
        "    tcp-request content set-dst var(txn.dst) if { var(txn.dst) -m found }",
        // Same internal-destination guard as the inspected path; see INTERNAL_RANGES.
        `    acl pass_dst_internal var(txn.dst) -m ip ${dstInternalAddrs.join(" ")}`,
        ...hostAddrAcl("pass_dst_internal", "var(txn.dst)"),
        "    tcp-request content set-var(txn.reason) str(internal-address) " +
          "if { var(txn.tlsrule) -m found } pass_dst_internal",
        "    tcp-request content reject if { var(txn.tlsrule) -m found } pass_dst_internal",
      );
    }

    // Only passthroughs log here; the inspected frontends log the request, so
    // logging it here too would double it.
    l.push(
      "",
      "    tcp-request content set-log-level silent unless { var(txn.pass) -m found }",
      // The SNI is last, being the one field whose length the build chooses:
      // a cut line then costs the name, not the decision.
      `    log-format "buildcage %[date(0,ms)] pass %[var(txn.proto)] %B ts=%ts ` +
        `reason=%[var(txn.reason)] dst=%[dst]:%[dst_port] sni=%[var(txn.sni)]"`,
      "",
    );
  }
  l.push(
    "    # `accept` ends content-rule evaluation, so it comes after every rule",
    "    # that needs the request buffer (the SNI capture and resolution above).",
    "    tcp-request content accept if { req.ssl_hello_type 1 } || { req.len gt 0 }",
    "",
  );
  if (hasPassthrough) {
    // txn.pass is set by exactly the conds above, so this selects the same
    // connections without repeating them on one line. Backend selection runs
    // after every content rule whatever the written order, so this sits below
    // the accept above rather than drawing a warning by preceding it.
    l.push("    use_backend passthrough if { var(txn.pass) -m found }", "");
  }
  l.push(
    "    acl is_tls req.ssl_hello_type 1",
    "    use_backend to_tls if is_tls",
    "    default_backend to_plain",
    "",
    "backend passthrough",
    "    mode tcp",
    "    server origin 0.0.0.0",
    "",
    "backend to_tls",
    "    mode tcp",
    `    server s 127.0.0.1:${TLS_STAGE_PORT} send-proxy-v2`,
    "",
    "backend to_plain",
    "    mode tcp",
    `    server s 127.0.0.1:${PLAIN_STAGE_PORT} send-proxy-v2`,
    "",
  );

  // --- stage 2: inspect -----------------------------------------------------
  const stage = (
    name: string,
    port: number,
    bindExtra: string,
    scheme: "https" | "http",
    rules: CompiledRule[],
    backend: string,
  ) => {
    l.push(
      `frontend ${name}`,
      `    bind 127.0.0.1:${port} accept-proxy${bindExtra}`,
      "    mode http",
      // Host is attacker-controlled too, but keeps its own ":port" (unlike
      // SNI), so it can't be reduced to a hostname charset. Single-quoted as
      // a whole so the word parser leaves the embedded " alone for regsub's
      // own (config manual: "Quoting and escaping") argument quoting to handle.
      `    http-request capture 'req.hdr(host),regsub("[\\s\\"[:cntrl:]]",_,g)' len 100`,
      "",
      "    # Decode before stripping `..`: `.` is unreserved, so `%2e%2e` is not",
      "    # a dot-dot segment until decoded, and stripping first would miss it.",
      "    http-request normalize-uri percent-decode-unreserved",
      "    http-request normalize-uri path-strip-dotdot",
      "",
      "    # pathq, not %HU: %HU is the target as sent (a path over HTTP/1.1, an",
      "    # absolute URI over HTTP/2), and pathq is not readable at log time.",
      "    # Set after normalisation, so the log shows the path the rules matched.",
      // Same idea as the Host capture above, minus \s: a raw space can't
      // reach a path (HTTP's own request-line parsing rejects it first).
      `    http-request set-var(txn.pathq) 'pathq,regsub("[\\"[:cntrl:]]",_,g)'`,
      "",
      "    # `%2f` and `%5c` survive decoding (both reserved) yet an origin may",
      "    # read `..%2f` / `..%5c` as a segment, and a raw backslash is not a",
      "    # valid path char at all. None is stripped, so each is refused. A lone",
      "    # encoded separator stays legal (e.g. npm's `/@scope%2fpackage`).",
      "    # `\\\\` is one literal backslash: HAProxy's parser takes the pair as one.",
      "    http-request deny deny_status 403 if { path -m reg -i (^|/|%2f|%5c)\\.\\.($|/|%2f|%5c) }",
      "    http-request deny deny_status 403 if { path -m sub \\\\ }",
      // %ts tells a refusal from an origin's own 403 or 503, reason says which
      // refusal. Both sit ahead of the URL, the one field that could cut the line.
      `    log-format "buildcage %[date(0,ms)] ${scheme} %HM %ST %B ts=%ts reason=%[var(txn.reason)] dst=%[dst]:%[dst_port] ${scheme}://%[capture.req.hdr(0)]%[var(txn.pathq)]"`,
      "",
    );
    // The rules decide first, on the request alone (host, path, method): none
    // of them depend on where the name resolves. Only a request they already
    // allow reaches the do-resolve below, so a name a request would be denied
    // for never triggers a real DNS query -- do-resolve is the only place a
    // real query leaves this proxy, and it must never run ahead of a deny.
    l.push(...ruleBlock(rules, mode, scheme));
    // Skipped entirely when the block above denies unconditionally: HAProxy
    // would never reach these rules, and warns that they are NOOP.
    if (hasResolver && !deniesEverything(rules, mode)) {
      l.push(
        "    # Connect where WE resolve the Host, discarding the client's address,",
        "    # so a forged Host or doctored /etc/hosts cannot choose the target.",
        "    # host_only drops the port a header carries, which is not part of the",
        "    # name. An address is taken as-is: no resolver can answer one, and the",
        "    # rules above already decided, so nothing is loosened.",
        `    acl host_is_address req.hdr(host),${HOST_ONLY} -m reg ${HOST_IS_ADDRESS}`,
        `    http-request set-var(txn.dst) req.hdr(host),${HOST_ONLY} if host_is_address`,
        `    http-request do-resolve(txn.dst,buildcage,ipv4) req.hdr(host),lower,${HOST_ONLY} ` +
          "unless host_is_address",
        "    # A fresh attempt, not a replay: nothing cached the failure.",
        `    http-request do-resolve(txn.dst,buildcage,ipv4) req.hdr(host),lower,${HOST_ONLY} ` +
          "unless host_is_address or { var(txn.dst) -m found }",
        "    http-request set-var(txn.reason) str(dns-failed) unless { var(txn.dst) -m found }",
        "    http-request deny deny_status 502 unless { var(txn.dst) -m found }",
        "",
        "    # Set before the internal-destination check below, not after: %[dst] in",
        "    # the log-format is this, and a refusal must show the address that",
        "    # tripped it, not whatever the client's own (fake, unresolved) address",
        "    # was -- CoreDNS never hands out a real one, see coredns-config.ts.",
        "    http-request set-dst var(txn.dst)",
        "",
        "    # A resolved destination may not be internal; see INTERNAL_RANGES. An",
        "    # address named in a rule is exempt.",
        `    acl dst_internal var(txn.dst) -m ip ${dstInternalAddrs.join(" ")}`,
        ...hostAddrAcl("dst_internal", "var(txn.dst)"),
        "    http-request set-var(txn.reason) str(internal-address) if dst_internal !host_is_address",
        "    http-request deny deny_status 403 if dst_internal !host_is_address",
        "",
      );
    }
    l.push(`    default_backend ${backend}`, "");
  };

  stage(
    "https_in",
    TLS_STAGE_PORT,
    ` ssl crt ${opts.defaultCertFile} generate-certificates ca-sign-file ${opts.caSignFile}`,
    "https",
    httpsRules,
    "origin_tls",
  );
  stage("http_in", PLAIN_STAGE_PORT, "", "http", httpRules, "origin_plain");

  l.push(
    "# The only place a request reaches the origin, so where its certificate is",
    "# checked; a refused request never gets here. host_only on the SNI, since a",
    "# certificate is verified against a name, not a name and port.",
    "backend origin_tls",
    "    mode http",
    `    server origin 0.0.0.0 ssl verify required ca-file ${opts.systemCaFile} sni req.hdr(host),lower,${HOST_ONLY}`,
    "",
    "backend origin_plain",
    "    mode http",
    "    server origin 0.0.0.0",
    "",
  );

  return { config: l.join("\n"), warnings };
}

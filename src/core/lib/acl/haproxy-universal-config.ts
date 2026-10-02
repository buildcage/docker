/**
 * haproxy.cfg generator for the `universal` engine.
 *
 * Nothing is decrypted: a TLS connection is judged on its SNI and a plaintext
 * one on its Host header, each as `name:port` against the rules' regexes,
 * and a connection to an address no name led to against the IP rules. The
 * name is resolved here once the rules allow it, as in the `inspect` engine.
 */

import { PROXY_SUBNET } from "../log/proxy-address.ts";
import { internalDstAcl, type InternalDstOptions } from "./haproxy-internal-dst.ts";
import { escapeForHaproxy, HOSTNAME_CHARSET } from "./haproxy-matchers.ts";
import { compileRuleSet, INTERNAL_RANGES, type CompiledRule } from "./haproxy-rules.ts";
import { preamble, resolversSection } from "./haproxy-sections.ts";
import { convertRule } from "./wildcard-rules.ts";

export interface UniversalHaproxyConfigOptions {
  /** `audit` records without enforcing, so every rule list matches anything. */
  mode?: "restrict" | "audit";
  httpsRules?: string[];
  httpRules?: string[];
  ipRules?: string[];
  /** The address CoreDNS answers every name with. */
  proxyAddress: string;
  /** Pattern file of the runner's own addresses; see InternalDstOptions. */
  hostAddressFile: string;
}

/** A rule list's regexes, each with the rule it came from for a comment. */
interface Pattern {
  raw: string | null;
  regex: string;
}

const MATCH_ANYTHING: Pattern[] = [{ raw: null, regex: ".*" }];

const LISTEN_PORT = 10024;

/**
 * A host rule as one regex over `name:port`, which is how this engine matches
 * it. A `~` rule's own regex already covers the port.
 */
function hostPortRegex(rule: CompiledRule): string {
  if (rule.hostMatch === "hostPort") return rule.hostRegex;
  return `${rule.hostRegex.slice(0, -1)}:${rule.port ?? "\\d+"}$`;
}

/**
 * One acl line per pattern: repeating an acl name ORs the lines, and no line
 * can grow past HAProxy's MAX_LINE_ARGS words.
 */
function aclLines(name: string, fetch: string, patterns: Pattern[]): string[] {
  // An acl that is never declared fails the config, so an empty list still
  // needs one that matches nothing.
  if (patterns.length === 0) return [`    acl ${name} always_false`];
  return patterns.flatMap(({ raw, regex }) => [
    ...(raw === null ? [] : [`    # ${raw}`]),
    `    acl ${name} ${fetch} -m reg -i ${escapeForHaproxy(regex)}`,
  ]);
}

/**
 * Generate the `universal` engine's haproxy.cfg.
 *
 * @throws {Error} if a rule is malformed
 */
export function generateUniversalHaproxyConfig(options: UniversalHaproxyConfigOptions): string {
  const audit = options.mode === "audit";
  const toSelf = `!is_dns_routed is_ip_match ip_dst_internal { dst_port ${LISTEN_PORT} }`;
  let https = MATCH_ANYTHING;
  let http = MATCH_ANYTHING;
  let ip = MATCH_ANYTHING;
  // audit allows everything, so its rules are not compiled at all.
  if (!audit) {
    // Refuses a wildcard inside a label, which compileRuleSet allows but this
    // engine's grammar does not.
    [...(options.httpsRules ?? []), ...(options.httpRules ?? [])].forEach(convertRule);
    const compiled = compileRuleSet(options);
    https = compiled.https.map((rule) => ({ raw: rule.raw, regex: hostPortRegex(rule) }));
    http = compiled.http.map((rule) => ({ raw: rule.raw, regex: hostPortRegex(rule) }));
    // The address is matched as text, so a CIDR block becomes the regex over
    // the addresses it covers.
    ip = compiled.ip.map((rule) => ({ raw: rule.raw, regex: convertRule(rule.raw) }));
  }

  const decision = audit ? "AUDIT" : "ALLOWED";
  const guard: InternalDstOptions = {
    internalAddrs: [...INTERNAL_RANGES, PROXY_SUBNET],
    hostAddressFile: options.hostAddressFile,
  };

  const config = [
    ...preamble({
      global: ["    maxconn 2048"],
      defaults: ["    mode tcp", "    timeout client 1m", "    timeout server 1m"],
    }),
    ...resolversSection(),
    "# --- Frontend ---",
    "frontend outbound_proxy",
    `    bind *:${LISTEN_PORT}`,
    "    tcp-request inspect-delay 5s",
    "",
    // Any reject leaves txn.decision at BLOCKED; only a connection that
    // passes every check overwrites it.
    "    tcp-request content set-var(txn.decision) str(BLOCKED)",
    "    tcp-request content set-var(txn.reason) str(-)",
    "    tcp-request content set-var-fmt(txn.target) %[dst]:%[dst_port]",
    "    tcp-request content set-var(txn.rule_type) str(UNKNOWN)",
    "",
    // dst is the proxy only when the name went through this container's DNS.
    `    acl is_dns_routed dst ${options.proxyAddress}`,
    // set-dst below overwrites dst, so the state is captured first.
    "    tcp-request content set-var(txn.dns_routed) str(true) if is_dns_routed",
    "",
    "    acl is_tls req.ssl_hello_type 1",
    "    acl has_sni req_ssl_sni -m found",
    "",
    // Its own variable, never overwritten: an acl is evaluated where it is
    // used, and txn.target below turns into the client-chosen SNI.
    "    tcp-request content set-var-fmt(txn.dst_target) %[dst]:%[dst_port]",
    ...aclLines("is_ip_match", "var(txn.dst_target)", ip),
    "",
    "    # ---------------------------------------------------------",
    "    # 1. IP direct access (non DNS-routed)",
    "    # ---------------------------------------------------------",
    // Ahead of every rule that reads the client's first bytes: an IP rule needs
    // none, and a client waiting for the server to speak first would otherwise
    // sit out inspect-delay.
    "    tcp-request content set-var(txn.rule_type) str(IP) if !is_dns_routed",
    // A passthrough to the proxy's own listener comes straight back in, without
    // end. audit's IP list matches anything, so this covers it too.
    ...internalDstAcl("ip_dst_internal", guard, "dst"),
    `    tcp-request content set-var(txn.reason) str(internal-address) if ${toSelf}`,
    `    tcp-request content reject if ${toSelf}`,
    `    tcp-request content set-var(txn.decision) str(${decision}) if !is_dns_routed is_ip_match`,
    "    tcp-request content accept if !is_dns_routed is_ip_match",
    "",
    ...(audit ? ["    tcp-request content accept if !is_dns_routed !is_ip_match"] : []),
    "    tcp-request content set-var(txn.reason) str(ip-not-allowed) if !is_dns_routed !is_ip_match",
    "    tcp-request content reject if !is_dns_routed !is_ip_match",
    "",
    // A trailing dot denotes the same DNS name, so it must not affect
    // matching, resolution or logging. Stripped once here, upstream of every
    // other use.
    "    tcp-request content set-var(txn.sni) req_ssl_sni,regsub(\\.$,) if is_tls",
    "    tcp-request content set-var-fmt(txn.sni_port) %[var(txn.sni)]:%[dst_port] if is_tls",
    // The SNI is attacker-chosen raw bytes that HAProxy copies into
    // log-format verbatim, and +E would only escape " \ ], never LF. So the
    // copy that reaches the log is reduced to a hostname charset; the acls
    // still match the untouched txn.sni_port.
    "    tcp-request content set-var(txn.sni_log) var(txn.sni),regsub([^A-Za-z0-9._-],_,g) if is_tls has_sni",
    "",
    ...aclLines("is_https_allowed", "var(txn.sni_port)", https),
    `    acl sni_is_name var(txn.sni) -m reg ${HOSTNAME_CHARSET}`,
    "",
    // Only after the IP section, so an IP row logs the address it went to.
    "    tcp-request content set-var-fmt(txn.target) %[var(txn.sni_log)]:%[dst_port] if is_tls has_sni",
    "",
    "    # ---------------------------------------------------------",
    "    # 2. TLS without SNI",
    "    # ---------------------------------------------------------",
    "    tcp-request content set-var(txn.rule_type) str(HTTPS) if is_tls",
    "    tcp-request content set-var(txn.reason) str(missing-sni) if is_tls !has_sni",
    "    tcp-request content reject if is_tls !has_sni",
    "    tcp-request content set-var(txn.reason) str(invalid-sni) if is_tls has_sni !sni_is_name",
    "    tcp-request content reject if is_tls has_sni !sni_is_name",
    "",
    "    # ---------------------------------------------------------",
    "    # 3. TLS allowlist check (before DNS to avoid resolving blocked domains)",
    "    # ---------------------------------------------------------",
    "    tcp-request content set-var(txn.reason) str(not-allowed) if is_tls has_sni !is_https_allowed",
    "    tcp-request content reject if is_tls has_sni !is_https_allowed",
    "",
    "    # ---------------------------------------------------------",
    "    # 4. TLS DNS resolution, destination override & accept",
    "    # ---------------------------------------------------------",
    "    tcp-request content do-resolve(txn.dst,buildcage,ipv4) var(txn.sni) if is_tls has_sni",
    "    tcp-request content set-var(txn.reason) str(dns-failed) if is_tls has_sni ! { var(txn.dst) -m found }",
    "    tcp-request content reject if is_tls has_sni ! { var(txn.dst) -m found }",
    // Unlike `inspect`, no rule-named address is exempt: a name resolving
    // to a never-public range is refused whatever the rules say.
    ...internalDstAcl("dst_internal", guard),
    "    tcp-request content set-var(txn.reason) str(internal-address) if is_tls has_sni dst_internal",
    "    tcp-request content reject if is_tls has_sni dst_internal",
    "    tcp-request content set-dst var(txn.dst) if is_tls has_sni",
    `    tcp-request content set-var(txn.decision) str(${decision}) if is_tls has_sni`,
    "    tcp-request content accept if is_tls has_sni",
    "",
    "    # ---------------------------------------------------------",
    "    # 5. Non-TLS DNS-routed → HTTP frontend",
    "    # ---------------------------------------------------------",
    // http_in logs these itself, request by request.
    "    tcp-request content set-log-level silent if { var(txn.dns_routed) -m found } !is_tls",
    "    use_backend ip_passthrough if !{ var(txn.dns_routed) -m found }",
    "    use_backend tls_passthrough if is_tls",
    "    default_backend http_relay",
    "",
    // %[date(0,ms)] leads so the report can order the timeline and time each
    // line against the startup marker; %B is the only per-connection detail a
    // passthrough has, seeing no method, URL or status. Parsed by
    // log/haproxy.ts.
    '    log-format "buildcage %[date(0,ms)] [%[var(txn.decision)]] (%[var(txn.rule_type)]) \\"%[var(txn.target)]\\" %[var(txn.reason)] %B"',
    "",
    "# --- IP direct passthrough backend ---",
    "backend ip_passthrough",
    "    mode tcp",
    "    server cleartext 0.0.0.0:0",
    "",
    "# --- TLS passthrough backend ---",
    "backend tls_passthrough",
    "    mode tcp",
    "    server cleartext 0.0.0.0:0",
    "",
    // A frontend of its own, so a connection that ends before its request is
    // still logged with its termination state.
    "# --- HTTP frontend (L7) ---",
    "backend http_relay",
    "    mode tcp",
    "    server http_in 127.0.0.1:10026 send-proxy-v2",
    "",
    "frontend http_in",
    "    bind 127.0.0.1:10026 accept-proxy",
    "    mode http",
    // outbound_proxy's client timeout runs from the connection, this
    // frontend's from the hand-off after outbound_proxy's 5s inspect-delay.
    // Ending a silent client's wait here first logs it as a timeout rather
    // than a close. The keep-alive wait stays at the client timeout.
    "    timeout http-request 50s",
    "    timeout http-keep-alive 1m",
    // accept-proxy keeps the build's dst, which names a request with no Host.
    "    http-request set-var(txn.decision) str(BLOCKED)",
    "    http-request set-var(txn.reason) str(-)",
    "    http-request set-var-fmt(txn.target) %[dst]:%[dst_port]",
    // With no request parsed, no rule runs; %ts then says who ended it.
    '    log-format "buildcage %[date(0,ms)] [%[var(txn.decision)]] (HTTP) \\"%[var(txn.target)]\\" %[var(txn.reason)] %B ts=%ts dst=%[dst]:%[dst_port]"',
    "    default_backend http_filter_backend",
    "",
    // A deny leaves txn.decision at BLOCKED, as set in http_in.
    "backend http_filter_backend",
    "    mode http",
    "",
    "    acl has_host hdr(host) -m found",
    "    acl host_not_empty hdr_len(host) gt 0",
    "    http-request set-var(txn.reason) str(missing-host-header) if !has_host or !host_not_empty",
    '    http-request deny deny_status 400 content-type "text/plain" string "Bad Request: Missing Host Header" if !has_host or !host_not_empty',
    "",
    // A trailing dot denotes the same DNS name, as for the SNI.
    "    http-request set-var(txn.host_only) hdr(host),regsub(:.*$,),regsub(\\.$,)",
    "    http-request set-var-fmt(txn.host_port) %[var(txn.host_only)]:%[dst_port]",
    "",
    // The Host header is attacker-chosen too.
    "    http-request set-var(txn.host_log) var(txn.host_only),regsub([^A-Za-z0-9._-],_,g)",
    "    http-request set-var-fmt(txn.target) %[var(txn.host_log)]:%[dst_port]",
    "",
    ...aclLines("is_http_allowed", "var(txn.host_port)", http),
    "    http-request set-var(txn.reason) str(not-allowed) if !is_http_allowed",
    '    http-request deny deny_status 403 content-type "text/plain" string "Blocked by egress proxy" if !is_http_allowed',
    "",
    "    http-request do-resolve(txn.dst,buildcage,ipv4) var(txn.host_only)",
    // A fresh attempt, not a replay: nothing cached the failure. The TLS path
    // has no room for one inside its inspect-delay.
    "    http-request do-resolve(txn.dst,buildcage,ipv4) var(txn.host_only) unless { var(txn.dst) -m found }",
    "    http-request set-var(txn.reason) str(dns-failed) if ! { var(txn.dst) -m found }",
    '    http-request deny deny_status 503 content-type "text/plain" string "DNS Resolution Failed" if ! { var(txn.dst) -m found }',
    "",
    ...internalDstAcl("dst_internal_http", guard),
    "    http-request set-var(txn.reason) str(internal-address) if dst_internal_http",
    '    http-request deny deny_status 403 content-type "text/plain" string "Blocked by egress proxy" if dst_internal_http',
    "",
    "    http-request set-dst var(txn.dst)",
    `    http-request set-var(txn.decision) str(${decision})`,
    "",
    "    server cleartext 0.0.0.0:0",
    "",
  ];

  return config.join("\n");
}

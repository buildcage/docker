import { internalDstAcl, type InternalDstOptions } from "./haproxy-internal-dst.ts";
import {
  escapeForHaproxy,
  HOST_ONLY,
  HOSTNAME_CHARSET,
  hostMatcher,
  pathMatcher,
} from "./haproxy-matchers.ts";
import { deniesEverything, ruleBlock } from "./haproxy-rule-block.ts";
import { HOST_IS_ADDRESS, type CompiledRule } from "./haproxy-rules.ts";

/** One inspected frontend; the pair differs only in these. */
export interface InspectStageSpec {
  name: string;
  /** The loopback port detect's backend hands this scheme to. */
  port: number;
  /** Appended to the bind line; only the TLS stage terminates TLS. */
  bindExtra: string;
  scheme: "https" | "http";
  rules: CompiledRule[];
  backend: string;
}

/** What both frontends share. */
export interface InspectStageContext extends InternalDstOptions {
  mode: "restrict" | "audit";
  hasResolver: boolean;
}

/** The SNI field, for the stage that terminates TLS. It names the host of a
 *  connection that ended before its request, where `%HM` and the logged Host
 *  are both empty. Client-controlled, hence the detect frontend's charset. */
function sniField(scheme: "https" | "http"): string {
  return scheme === "https" ? " sni=%[ssl_fc_sni,regsub([^A-Za-z0-9._-],_,g)]" : "";
}

function addressRules(rules: CompiledRule[]): CompiledRule[] {
  const isAddress = new RegExp(HOST_IS_ADDRESS);
  return rules.filter((rule) => {
    if (rule.hostMatch !== "wildcard") return false;
    const { op, pattern } = hostMatcher(rule.hostRegex);
    return op === "-m str" && isAddress.test(pattern);
  });
}

/**
 * Exempt an internal destination only where a rule naming that address as its
 * host matches the whole request, so `**:80` cannot open 169.254.169.254.
 * Matched here, not in the rule block: audit has none but still guards.
 */
function internalGuard(rules: CompiledRule[]): string[] {
  const named = addressRules(rules);
  if (named.length === 0) {
    return [
      "    http-request set-var(txn.reason) str(internal-address) if dst_internal",
      "    http-request deny deny_status 403 if dst_internal",
      "",
    ];
  }
  const lines = ["    # An address a rule names as its host is exempt where that rule matches."];
  for (const rule of named) {
    const path = pathMatcher(rule.pathRegex);
    const conds = [
      `{ var(txn.host) -m str ${hostMatcher(rule.hostRegex).pattern} }`,
      ...(rule.port ? [`{ dst_port ${rule.port} }`] : []),
      `{ path ${path.op} ${escapeForHaproxy(path.pattern)} }`,
      ...(rule.methods ? [`{ method ${rule.methods.join(" ")} }`] : []),
    ];
    lines.push(
      `    # ${rule.raw}`,
      `    http-request set-var(txn.named_address) bool(true) if ${conds.join(" ")}`,
    );
  }
  lines.push(
    "    acl named_address var(txn.named_address) -m bool",
    "    http-request set-var(txn.reason) str(internal-address) if dst_internal !named_address",
    "    http-request deny deny_status 403 if dst_internal !named_address",
    "",
  );
  return lines;
}

/** Plaintext stage only: the TLS handshake passing through detect keeps
 *  detect's clock behind this frontend's. */
const PLAIN_REQUEST_TIMEOUTS = [
  "    # detect's client timeout runs from the connection, this frontend's from",
  "    # the hand-off after detect's 5s inspect-delay. Ending a silent client's",
  "    # wait here first logs it as a timeout rather than a close. The",
  "    # keep-alive wait stays at the client timeout.",
  "    timeout http-request 20s",
  "    timeout http-keep-alive 30s",
];

/**
 * A frontend that terminates the connection, normalizes the request, lets the
 * rules decide, and only then resolves the Host and connects there.
 */
export function inspectStage(
  { name, port, bindExtra, scheme, rules, backend }: InspectStageSpec,
  ctx: InspectStageContext,
): string[] {
  const { mode, hasResolver } = ctx;
  const l: string[] = [];
  l.push(
    `frontend ${name}`,
    `    bind 127.0.0.1:${port} accept-proxy${bindExtra}`,
    "    mode http",
    ...(scheme === "http" ? PLAIN_REQUEST_TIMEOUTS : []),
    // Host is attacker-controlled too, but keeps its own ":port" (unlike
    // SNI), so it can't be reduced to a hostname charset. Single-quoted as
    // a whole so the word parser leaves the embedded " alone for regsub's
    // own (config manual: "Quoting and escaping") argument quoting to handle.
    // A variable rather than a capture, whose fixed length would cut a padded
    // name before the domain that registered it.
    `    http-request set-var(txn.host_log) 'req.hdr(host),regsub("[\\s\\"[:cntrl:]]",_,g)'`,
    "",
    "    # Decode before stripping `..`: `.` is unreserved, so `%2e%2e` is not",
    "    # a dot-dot segment until decoded, and stripping first would miss it.",
    "    http-request normalize-uri percent-decode-unreserved",
    "    http-request normalize-uri path-strip-dotdot",
    "",
    "    # pathq, not %HU: %HU is the target as sent (a path over HTTP/1.1, an",
    "    # absolute URI over HTTP/2), and pathq is not readable at log time.",
    "    # Set after normalization, so the log shows the path the rules matched.",
    // Same idea as the Host above, minus \s: a raw space can't
    // reach a path (HTTP's own request-line parsing rejects it first).
    `    http-request set-var(txn.pathq) 'pathq,regsub("[\\"[:cntrl:]]",_,g)'`,
    "",
    "    # A request with no Host names nothing: the rules match on it, the",
    "    # origin is resolved from it, and the log's URL is built from it. Named",
    "    # here rather than left to the log's own empty fields, which a Host the",
    "    # client chose can imitate. Refused in `audit` too, as the same check",
    "    # in the universal engine is: there is nothing to connect to either way.",
    "    # Ahead of the path denies below, so that a request carrying neither a",
    "    # Host nor a legal path is named by the one the report can act on: the",
    "    # other leaves a row named for the `-` the log prints in its place.",
    "    acl has_host hdr(host) -m found",
    "    acl host_not_empty hdr_len(host) gt 0",
    "    http-request set-var(txn.reason) str(missing-host-header) if !has_host or !host_not_empty",
    "    http-request deny deny_status 400 if !has_host or !host_not_empty",
    "",
    "    # The one Host every later step reads. An acl on req.hdr(host) scans",
    "    # every value while a fetch takes the last, so reading the header twice",
    "    # could judge one value and connect to another.",
    `    http-request set-var(txn.host) req.hdr(host),lower,${HOST_ONLY}`,
    "    # A `:` left in the name could let a `~` rule's port pattern match it.",
    "    # Refused in `audit` too.",
    `    acl host_is_name var(txn.host) -m reg ${HOSTNAME_CHARSET}`,
    "    http-request set-var(txn.reason) str(invalid-host) if !host_is_name",
    "    http-request deny deny_status 400 if !host_is_name",
    "",
    "    # `%2f` and `%5c` survive decoding (both reserved) yet an origin may",
    "    # read `..%2f` / `..%5c` as a segment, and a raw backslash is not a",
    "    # valid path char at all. None is stripped, so each is refused. A lone",
    "    # encoded separator stays legal (e.g. npm's `/@scope%2fpackage`).",
    "    # `;` (or `%3b`) ends a segment too: Tomcat and Jetty drop what follows",
    "    # as a path parameter, so they read `..;/` as `../`.",
    "    # `\\\\` is one literal backslash: HAProxy's parser takes the pair as one.",
    "    http-request deny deny_status 403 if { path -m reg -i (^|/|%2f|%5c)\\.\\.($|/|;|%2f|%5c|%3b) }",
    "    http-request deny deny_status 403 if { path -m sub \\\\ }",
    "",
    // %ts tells a refusal from an origin's own 403 or 503, reason says which
    // refusal, and tlserr carries haproxy's own error from the handshake with
    // the origin (see log/inspect.ts's reasonFor). All three sit ahead of the
    // target, the one field that could cut the line.
    // host and target are two fields rather than one URL: pathq is empty for
    // a request-target that is not a path (`OPTIONS *`, RFC 9112 §3.2.4, and
    // a CONNECT's authority), the log-format prints an empty sample as `-`,
    // and log/inspect.ts would read the joined-up
    // `https://registry.npmjs.org-` as a host no rule can be written for.
    `    log-format "buildcage %[date(0,ms)] ${scheme} %HM %ST %B ts=%ts reason=%[var(txn.reason)] tlserr=%[ssl_bc_err] dst=%[dst]:%[dst_port]${sniField(scheme)} host=%[var(txn.host_log)] %[var(txn.pathq)]"`,
    "",
  );
  // The rules decide first, on the request alone (host, path, method): none
  // of them depend on where the name resolves. Only a request they already
  // allow reaches the do-resolve below, so a name a request would be denied
  // for never triggers a real DNS query. do-resolve is the only place a real
  // query leaves this proxy, and it must never run ahead of a deny.
  l.push(...ruleBlock(rules, mode, scheme));
  // Skipped entirely when the block above denies unconditionally: HAProxy
  // would never reach these rules, and warns that they are NOOP.
  if (hasResolver && !deniesEverything(rules, mode)) {
    l.push(
      "    # Connect to the address this proxy resolves the Host to, discarding",
      "    # the client's address, so a forged Host or doctored /etc/hosts cannot",
      "    # choose the target.",
      "    # txn.host has already dropped the port a header carries, which is not",
      "    # part of the name. An address is taken as-is: no resolver can answer",
      "    # one, and the rules above already decided, so nothing is loosened.",
      `    acl host_is_address var(txn.host) -m reg ${HOST_IS_ADDRESS}`,
      "    http-request set-var(txn.dst) var(txn.host) if host_is_address",
      "    http-request do-resolve(txn.dst,buildcage,ipv4) var(txn.host) unless host_is_address",
      "    # A fresh attempt, not a replay: nothing cached the failure.",
      "    http-request do-resolve(txn.dst,buildcage,ipv4) var(txn.host) " +
        "unless host_is_address or { var(txn.dst) -m found }",
      "    http-request set-var(txn.reason) str(dns-failed) unless { var(txn.dst) -m found }",
      "    http-request deny deny_status 502 unless { var(txn.dst) -m found }",
      "",
      "    # Set before the internal-destination check below, not after: %[dst] in",
      "    # the log-format is this, and a refusal must show the address that",
      "    # tripped it, not whatever the client's own (fake, unresolved) address",
      "    # was: CoreDNS never hands out a real one; see coredns-config.ts.",
      "    http-request set-dst var(txn.dst)",
      "",
      "    # A resolved destination may not be internal; see INTERNAL_RANGES.",
      ...internalDstAcl("dst_internal", ctx),
      ...internalGuard(rules),
    );
  }
  l.push(`    default_backend ${backend}`, "");
  return l;
}

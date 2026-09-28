import { internalDstAcl, type InternalDstOptions } from "./haproxy-internal-dst.ts";
import { escapeForHaproxy, HOSTNAME_CHARSET } from "./haproxy-matchers.ts";
import type { CompiledIpRule, CompiledTlsRule } from "./haproxy-rules.ts";

export interface DetectFrontendSpec extends InternalDstOptions {
  listenPort: number;
  /** Loopback ports the two inspected frontends bind; see haproxy-config.ts. */
  tlsStagePort: number;
  plainStagePort: number;
  ipRules: CompiledIpRule[];
  tlsHosts: CompiledTlsRule[];
  hasResolver: boolean;
  /**
   * The address CoreDNS answers every name with. A connection to it came
   * through a name, so no IP rule may pass it through; see detectFrontend.
   */
  proxyAddress?: string;
}

/**
 * A tls rule's full condition. An SNI that is not a hostname never passes
 * through: it goes on to the inspected path, where its Host is judged.
 */
function tlsCond(host: CompiledTlsRule): string {
  return `${host.id}_sni${host.port ? ` ${host.id}_port` : ""} sni_is_name`;
}

/**
 * The single listener everything is redirected to, and the choice it makes:
 * pass the connection through untouched, or hand it to one of the inspected
 * frontends according to what the first bytes say it is.
 */
export function detectFrontend(spec: DetectFrontendSpec): string[] {
  const { listenPort, tlsStagePort, plainStagePort, ipRules, tlsHosts, hasResolver, proxyAddress } =
    spec;
  // Every name resolves to the proxy's own address, so an IP rule covering it
  // (`198.18.0.0/15:443`) would pass every named connection through
  // uninspected, to an origin that is the proxy itself.
  const excludeDnsRouted = ipRules.length > 0 && proxyAddress !== undefined;
  const notDnsRouted = excludeDnsRouted ? " !dns_routed" : "";
  const hasPassthrough = ipRules.length > 0 || tlsHosts.length > 0;
  const l: string[] = [];
  l.push(
    "# One listener for everything redirected here. The first bytes say whether",
    "# this is a handshake or a plain request, so no port has to be declared as",
    "# one or the other in advance.",
    "frontend detect",
    `    bind *:${listenPort}`,
    "    mode tcp",
    "    tcp-request inspect-delay 5s",
    "",
  );
  if (hasPassthrough) {
    l.push("    # Passed through untouched: judged before anything is decrypted.");
    if (ipRules.some((rule) => rule.hostMatch === "hostPort")) {
      // dst is IP-typed; a ~ rule's own regex covers address and port
      // together, so dst is stringified with the real port to match it.
      l.push("    tcp-request content set-var-fmt(txn.dst_str) %[dst]:%[dst_port]");
    }
    if (tlsHosts.some((host) => host.hostMatch === "hostPort")) {
      l.push("    tcp-request content set-var-fmt(txn.sni_port) %[req.ssl_sni]:%[dst_port]");
    }
    if (excludeDnsRouted) {
      l.push(
        "    # dst is the proxy only when the name went through this container's DNS.",
        `    acl dns_routed dst ${proxyAddress}`,
      );
    }
    for (const rule of ipRules) {
      l.push(`    # ${rule.raw}`);
      l.push(
        rule.hostMatch === "hostPort"
          ? `    acl ${rule.id}_dst var(txn.dst_str) -m reg ${escapeForHaproxy(rule.address)}`
          : `    acl ${rule.id}_dst dst ${rule.address}`,
      );
      if (rule.port) l.push(`    acl ${rule.id}_port dst_port ${rule.port}`);
    }
    if (tlsHosts.length > 0) {
      l.push(`    acl sni_is_name req.ssl_sni -m reg ${HOSTNAME_CHARSET}`);
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
    const tlsConds = tlsHosts.map(tlsCond);
    const conds = [
      ...ipRules.map((r) => `${r.id}_dst${r.port ? ` ${r.id}_port` : ""}${notDnsRouted}`),
      ...tlsConds,
    ];

    // A passthrough is never decrypted and so has no request line; this line
    // is its only record, carrying the name, destination and byte count.
    // Flagged before the rules below reject, so a refused passthrough is
    // logged too.
    l.push(
      "",
      // One line per rule, for the same word-limit reason as ruleBlock's deny.
      ...conds.map((cond) => `    tcp-request content set-var(txn.pass) int(1) if ${cond}`),
      // Only a tls rule judges the name; under an ip rule the SNI is just the
      // client's claim. Reduced to a safe charset, being attacker-controlled.
      ...tlsConds.map(
        (cond) =>
          `    tcp-request content set-var(txn.sni) req.ssl_sni,regsub([^A-Za-z0-9._-],_,g) if ${cond}`,
      ),
      "    tcp-request content set-var(txn.proto) str(tls) if { req.ssl_hello_type 1 }",
      "    tcp-request content set-var(txn.proto) str(tcp) unless { req.ssl_hello_type 1 }",
    );

    if (tlsHosts.length > 0 && hasResolver) {
      // The SNI is resolved here and connected to, as on the inspected path:
      // an SNI is not a destination, so a ClientHello with an allowed
      // name must not become a tunnel to an address of the build's choosing.
      // The flag variable is needed because HAProxy conditions have no
      // grouping: `a or b !c` reads as `a or (b and !c)`.
      l.push("");
      for (const host of tlsHosts) {
        // Ports scope a tls rule (see haproxy-rules.ts): without
        // the port ACL here too, an SNI matching a port-scoped rule on some
        // other port would still set txn.tlsrule, triggering an early
        // do-resolve/set-dst that overwrites the connection's destination
        // before the inspected path ever sees it, even though txn.pass
        // (gated on sni+port together) correctly never fires for it.
        l.push(`    tcp-request content set-var(txn.tlsrule) int(1) if ${tlsCond(host)}`);
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
        // inspected path; see the matching comment in haproxy-inspect-stage.ts.
        "    tcp-request content set-dst var(txn.dst) if { var(txn.dst) -m found }",
        ...internalDstAcl("pass_dst_internal", spec),
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
    `    server s 127.0.0.1:${tlsStagePort} send-proxy-v2`,
    "",
    "backend to_plain",
    "    mode tcp",
    `    server s 127.0.0.1:${plainStagePort} send-proxy-v2`,
    "",
  );
  return l;
}

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
  /**
   * The address CoreDNS answers every name with. A connection to it came
   * through a name, so no IP rule may pass it through; see detectFrontend.
   */
  proxyAddress: string;
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
  const { listenPort, tlsStagePort, plainStagePort, ipRules, tlsHosts, proxyAddress } = spec;
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
    const pass = "{ var(txn.pass) -m found }";
    l.push("    # Passed through untouched: judged before anything is decrypted.");
    if (ipRules.length > 0) {
      if (ipRules.some((rule) => rule.hostMatch === "hostPort")) {
        // dst is IP-typed; a ~ rule's own regex covers address and port
        // together, so dst is stringified with the real port to match it.
        l.push("    tcp-request content set-var-fmt(txn.dst_str) %[dst]:%[dst_port]");
      }
      // Every name resolves to the proxy's own address, so an IP rule covering it
      // (`198.18.0.0/15:443`) would pass every named connection through
      // uninspected, to an origin that is the proxy itself.
      l.push(
        "    # dst is the proxy only when the name went through this container's DNS.",
        `    acl dns_routed dst ${proxyAddress}`,
      );
      for (const rule of ipRules) {
        l.push(`    # ${rule.raw}`);
        l.push(
          rule.hostMatch === "hostPort"
            ? `    acl ${rule.id}_dst var(txn.dst_str) -m reg ${escapeForHaproxy(rule.address)}`
            : `    acl ${rule.id}_dst dst ${rule.address}`,
        );
        if (rule.port) l.push(`    acl ${rule.id}_port dst_port ${rule.port}`);
      }
      // An IP rule reads no byte from the client, so its passthrough is
      // accepted here, ahead of every rule below that waits for the first
      // bytes: a client waiting for the server to speak first would otherwise
      // sit out the whole inspect-delay. It is logged as tcp whatever it
      // carries, so the report lists it under the IP rule type, as universal's.
      // An IP rule wide enough to cover one of the proxy's own addresses would
      // pass a connection to this listener back into it, without end.
      const self = `${pass} ip_dst_internal { dst_port ${listenPort} }`;
      l.push(
        "",
        // One line per rule, for the same word-limit reason as ruleBlock's deny.
        ...ipRules.map(
          (r) =>
            `    tcp-request content set-var(txn.pass) int(1) if ${r.id}_dst${r.port ? ` ${r.id}_port` : ""} !dns_routed`,
        ),
        `    tcp-request content set-var(txn.proto) str(tcp) if ${pass}`,
        ...internalDstAcl("ip_dst_internal", spec, "dst"),
        `    tcp-request content set-var(txn.reason) str(internal-address) if ${self}`,
        `    tcp-request content reject if ${self}`,
        `    tcp-request content accept if ${pass}`,
      );
    }

    if (tlsHosts.length > 0) {
      if (tlsHosts.some((host) => host.hostMatch === "hostPort")) {
        l.push("    tcp-request content set-var-fmt(txn.sni_port) %[req.ssl_sni]:%[dst_port]");
      }
      l.push("", `    acl sni_is_name req.ssl_sni -m reg ${HOSTNAME_CHARSET}`);
      for (const host of tlsHosts) {
        l.push(`    # ${host.raw}`);
        l.push(
          host.hostMatch === "hostPort"
            ? `    acl ${host.id}_sni var(txn.sni_port) -m reg -i ${escapeForHaproxy(host.hostRegex)}`
            : `    acl ${host.id}_sni req.ssl_sni -m reg -i ${escapeForHaproxy(host.hostRegex)}`,
        );
        if (host.port) l.push(`    acl ${host.id}_port dst_port ${host.port}`);
      }
      // A passthrough is never decrypted and so has no request line; its log
      // line is its only record, carrying the name, destination and byte
      // count. Flagged before the rules below reject, so a refused passthrough
      // is logged too. An IP rule's connection is gone by now, so txn.pass
      // means a tls rule matched, on both its name and its port.
      l.push(
        "",
        // One line per rule, for the same word-limit reason as ruleBlock's deny.
        ...tlsHosts.map(
          (host) => `    tcp-request content set-var(txn.pass) int(1) if ${tlsCond(host)}`,
        ),
        // Reduced to a safe charset, being attacker-controlled.
        `    tcp-request content set-var(txn.sni) req.ssl_sni,regsub([^A-Za-z0-9._-],_,g) if ${pass}`,
        `    tcp-request content set-var(txn.proto) str(tls) if ${pass}`,
        "",
        // The SNI is resolved here and connected to, as on the inspected path:
        // an SNI is not a destination, so a ClientHello with an allowed
        // name must not become a tunnel to an address of the build's choosing.
        `    tcp-request content do-resolve(txn.dst,buildcage,ipv4) req.ssl_sni,lower if ${pass}`,
        `    tcp-request content set-var(txn.reason) str(dns-failed) if ${pass} !{ var(txn.dst) -m found }`,
        // Falling through would connect to the address the client chose.
        `    tcp-request content reject if ${pass} !{ var(txn.dst) -m found }`,
        // Before the internal-destination check below, not after, for the
        // same reason and with the same log-format consequence as the
        // inspected path; see the matching comment in haproxy-inspect-stage.ts.
        "    tcp-request content set-dst var(txn.dst) if { var(txn.dst) -m found }",
        ...internalDstAcl("pass_dst_internal", spec),
        `    tcp-request content set-var(txn.reason) str(internal-address) if ${pass} pass_dst_internal`,
        `    tcp-request content reject if ${pass} pass_dst_internal`,
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

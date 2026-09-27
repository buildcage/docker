import { escapeForHaproxy, hostMatcher, pathMatcher } from "./haproxy-matchers.ts";
import type { CompiledRule } from "./haproxy-rules.ts";
import { DEFAULT_PORT } from "./url-rules.ts";

/**
 * Whether this scheme's block refuses every request outright.
 *
 * Its deny carries no condition, so HAProxy treats it as final and skips every
 * http-request rule after it in the same frontend. Nothing may be emitted
 * below it.
 */
export function deniesEverything(rules: CompiledRule[], mode: string): boolean {
  return mode !== "audit" && rules.length === 0;
}

/** Emit the rule ACLs and the single deny that enforces them. */
export function ruleBlock(rules: CompiledRule[], mode: string, scheme: "https" | "http"): string[] {
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

  // Every host match reads txn.host, set once per request by inspectStage.
  if (rules.some((r) => r.hostMatch === "hostPort")) {
    // A ~ rule's own regex covers host and port together, so the host is
    // stringified with the real port once here for every such rule to match.
    lines.push("    http-request set-var-fmt(txn.host_port) %[var(txn.host)]:%[dst_port]");
  }
  if (rules.some((r) => r.hostMatch === "hostBareFull")) {
    // A ~ URL rule's port is optional; see haproxy-rules.ts's HostMatch doc comment.
    lines.push(
      `    acl is_default_port dst_port ${DEFAULT_PORT[scheme]}`,
      "    http-request set-var-fmt(txn.host_full) %[var(txn.host)]:%[dst_port]",
    );
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
          `{ var(txn.host) -m reg -i ${hostRegex} }`,
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

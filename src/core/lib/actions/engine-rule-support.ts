import { InvalidInputError, type ProxyEngine } from "./inputs.ts";

/**
 * Only `inspect` terminates TLS, so it's the only engine that can see an HTTP
 * method or a path, which makes `allowed_url_rules` and `allowed_tls_rules`
 * no-ops on `universal`. Called once at setup, before the proxy starts, so a
 * mismatch is caught immediately instead of silently not enforcing.
 *
 * In `restrict` mode this is an error: a rule that looks like it protects the
 * step but can't actually be enforced is worse than no rule at all. In
 * `audit` mode nothing is enforced anyway, so it's a warning: the step still
 * runs, with these rules ignored.
 */
export function checkUrlAndTlsRuleSupport(
  {
    proxyEngine,
    proxyMode,
    urlRules,
    tlsRules,
  }: {
    proxyEngine: ProxyEngine;
    proxyMode: string;
    urlRules: string[];
    tlsRules: string[];
  },
  warn: (message: string) => void,
): void {
  if (proxyEngine === "inspect") return;

  const unsupported: string[] = [];
  if (urlRules.length > 0) unsupported.push("allowed_url_rules");
  if (tlsRules.length > 0) unsupported.push("allowed_tls_rules");
  if (unsupported.length === 0) return;

  const list = unsupported.join(" and ");
  const verb = unsupported.length > 1 ? "have" : "has";
  const reason =
    `${list} ${verb} no effect with proxy_engine: ${proxyEngine}, which only sees the host ` +
    `and port, never a method or a path.`;

  if (proxyMode === "audit") {
    warn(
      `${reason} They are ignored for this run. Switch to proxy_engine: inspect if you need to ` +
        `enforce a method or a path.`,
    );
    return;
  }

  throw new InvalidInputError(
    `${reason} In restrict mode that means ${list} would not actually be enforced, so the ` +
      `step would look protected but isn't. Switch to proxy_engine: inspect, or remove ` +
      `${list} from your workflow.`,
    "INVALID_PROXY_ENGINE",
  );
}

/**
 * A URL rule in `known_blocked_rules` (a method and a URL) matches on a method
 * and a path, which only `inspect` sees, so it can never match a block on
 * another engine and acknowledges nothing there. Checked once at setup like
 * checkUrlAndTlsRuleSupport, and split the same way: an error in `restrict`,
 * where a rule that reads as covering a block but silently does not is worth
 * refusing, and a warning in `audit`, where nothing fails on a block anyway.
 *
 * A host rule (`host:port`) works on every engine and is not flagged; only the
 * URL lines are.
 */
export function checkKnownBlockedUrlRuleSupport(
  {
    proxyEngine,
    proxyMode,
    knownBlockedUrlRules,
  }: {
    proxyEngine: ProxyEngine;
    proxyMode: string;
    knownBlockedUrlRules: string[];
  },
  warn: (message: string) => void,
): void {
  if (proxyEngine === "inspect") return;
  if (knownBlockedUrlRules.length === 0) return;

  const reason =
    `known_blocked_rules contains URL rules (a method and a URL) that need proxy_engine: ` +
    `inspect, which alone sees a method or a path; proxy_engine: ${proxyEngine} sees only the ` +
    `host and port, so these rules match no blocked connection and acknowledge nothing.`;

  if (proxyMode === "audit") {
    warn(
      `${reason} They are ignored for this run. Drop the method to acknowledge the whole host, ` +
        `or switch to proxy_engine: inspect.`,
    );
    return;
  }

  throw new InvalidInputError(
    `${reason} Drop the method to acknowledge the whole host, or switch to proxy_engine: ` +
      `inspect.`,
    "INVALID_PROXY_ENGINE",
  );
}

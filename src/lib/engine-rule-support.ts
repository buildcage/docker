import { SetupError } from "./errors.ts";
import type { ProxyEngine } from "../main.ts";

/**
 * Only `inspect` terminates TLS, so it's the only engine that can see an HTTP
 * method or a path — `allowed_url_rules` and `allow_tls_rules` are no-ops on
 * `universal` / `explicit`. Called once at setup, before the container starts,
 * so a mismatch is caught immediately instead of silently not enforcing.
 *
 * In `restrict` mode this is an error: a rule that looks like it protects the
 * build but can't actually be enforced is worse than no rule at all. In
 * `audit` mode nothing is enforced anyway, so it's a warning — the build
 * still runs, with these rules ignored.
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
  if (tlsRules.length > 0) unsupported.push("allow_tls_rules");
  if (unsupported.length === 0) return;

  const list = unsupported.join(" and ");
  const verb = unsupported.length > 1 ? "have" : "has";
  const reason =
    `${list} ${verb} no effect with proxy_engine: ${proxyEngine} — this engine only sees the ` +
    `host and port, never a method or a path.`;

  if (proxyMode === "audit") {
    warn(
      `${reason} They are ignored for this run. Switch to proxy_engine: inspect if you need to ` +
        `enforce a method or a path.`,
    );
    return;
  }

  throw new SetupError(
    `${reason} In restrict mode that means ${list} would not actually be enforced — the build ` +
      `would look protected but isn't. Switch to proxy_engine: inspect, or remove ${list} from ` +
      `your workflow.`,
    "INVALID_PROXY_ENGINE",
  );
}

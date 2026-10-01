/**
 * Splitting an observed `host:port` authority, as it comes from a proxy log
 * line, a BuildKit source identifier or a URL in the traffic.
 *
 * Not for rule syntax: acl/ parses a grammar of its own, where a wildcard can
 * stand in for either half, and it decides where the port begins on its own
 * terms.
 */

/** The port a scheme implies, which an authority is free to leave out. */
export const DEFAULT_PORT: Record<string, string> = { https: "443", http: "80" };

export interface HostPort {
  host: string;
  /**
   * `undefined` when the authority carried no port separator at all. That is
   * not the same as a trailing `host:`, which is separated but empty, and
   * callers that substitute a default only want to do so for the former.
   */
  port: string | undefined;
}

/**
 * Split an authority at its port separator.
 *
 * An IPv6 literal is bracketed and carries colons of its own, so the last
 * colon is a separator only when it falls outside the brackets: `[::1]:443`
 * splits, `[::1]` does not. Reading the last colon unconditionally turns the
 * latter into host `[:` and port `1]`.
 */
export function splitHostPort(authority: string): HostPort {
  const colon = authority.lastIndexOf(":");
  if (colon <= 0 || authority.slice(colon + 1).includes("]")) {
    return { host: authority, port: undefined };
  }
  return { host: authority.slice(0, colon), port: authority.slice(colon + 1) };
}

/** A host as the rules match it: ASCII lowercased, with one trailing dot
 *  dropped (see HOST_ONLY). CoreDNS already logs names this way and the proxy
 *  logs are folded to it, so one host is one row whatever case it was spelled
 *  in. */
export function ruleHost(host: string): string {
  return host.replace(/[A-Z]/g, (c) => c.toLowerCase()).replace(/\.$/, "");
}

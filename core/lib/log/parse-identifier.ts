export interface ParsedIdentifier {
  scheme: string;
  host: string;
  port: string;
}

const DEFAULT_PORT: Record<string, string> = { https: "443", http: "80" };

/**
 * Parse a proxy-network source identifier ("https://host[:port]/path...")
 * into its scheme/host/port. BuildKit omits an explicit ":443"/":80" from the
 * identifier when the original request didn't specify a port, so a missing
 * port is filled in with the scheme's default. Returns null for non-http(s)
 * identifiers — buildcage's generated policy only ever denies ^https?://
 * sources, but this guards against unexpected input.
 */
export function parseIdentifier(identifier: string): ParsedIdentifier | null {
  const m = identifier.match(/^(https?):\/\/([^/]+)/);
  if (!m) return null;
  const [, scheme, hostPort] = m;
  const colonIdx = hostPort.lastIndexOf(":");
  if (colonIdx > 0) {
    return {
      scheme,
      host: hostPort.substring(0, colonIdx),
      port: hostPort.substring(colonIdx + 1),
    };
  }
  return { scheme, host: hostPort, port: DEFAULT_PORT[scheme] };
}

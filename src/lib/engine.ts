import {
  InvalidInputError,
  resolveProxyEngine as resolveSharedProxyEngine,
  type ProxyEngine,
} from "#core/lib/actions/inputs.ts";

/**
 * resolveProxyEngine, plus the engine only this action ever had: explicit
 * (BuildKit's native --proxy-network) was removed, so anyone still on it is
 * pointed at a supported engine rather than told the value is invalid.
 */
export function resolveProxyEngine(input: string | undefined): ProxyEngine {
  if (input?.trim() === "explicit") {
    throw new InvalidInputError(
      "proxy_engine: explicit has been removed. Use proxy_engine: universal (network-level SNI/Host inspection) or inspect (TLS-terminating URL enforcement).",
      "INVALID_PROXY_ENGINE",
    );
  }
  return resolveSharedProxyEngine(input);
}

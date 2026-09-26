import type { ProxyEngine } from "./engine.ts";
import { listHostIpv4Addresses } from "./host-addresses.ts";

export interface ComposeEnvOptions {
  builderName: string;
  proxyMode: string;
  proxyEngine: ProxyEngine;
  failOnCaResidue: boolean;
  imageRef: string;
  httpsRules: string[];
  httpRules: string[];
  ipRules: string[];
  urlRules: string[];
  tlsRules: string[];
  knownBlockedRules: string[];
}

/**
 * The environment `docker compose up` starts the builder with. Every value
 * the engine reads is set here rather than inherited, so nothing an earlier
 * workflow step left in the job environment can reach it.
 *
 * `hostAddresses` is an injectable seam for testing without reading the
 * runner's own interfaces, not a caller-facing precondition.
 */
export function buildComposeEnv(
  {
    builderName,
    proxyMode,
    proxyEngine,
    failOnCaResidue,
    imageRef,
    httpsRules,
    httpRules,
    ipRules,
    urlRules,
    tlsRules,
    knownBlockedRules,
  }: ComposeEnvOptions,
  env: NodeJS.ProcessEnv,
  hostAddresses: () => string[] = listHostIpv4Addresses,
): NodeJS.ProcessEnv {
  return {
    ...env,
    BUILDER_NAME: builderName,
    PROXY_MODE: proxyMode,
    PROXY_ENGINE: proxyEngine,
    // Read by buildcage-runc in each RUN step; universal has no CA to leave.
    FAIL_ON_CA_RESIDUE: String(failOnCaResidue),
    ALLOWED_HTTPS_RULES: httpsRules.join("\n"),
    ALLOWED_HTTP_RULES: httpRules.join("\n"),
    ALLOWED_IP_RULES: ipRules.join("\n"),
    // Newline separated because a URL rule contains a space, unlike the others.
    ALLOWED_URL_RULES: urlRules.join("\n"),
    ALLOWED_TLS_RULES: tlsRules.join("\n"),
    KNOWN_BLOCKED_RULES: knownBlockedRules.join("\n"),
    BUILDCAGE_IMAGE_REF: imageRef,
    // Pinned rather than inherited, like every other variable here: the
    // resolver the builder uses is the action's choice, not whatever an earlier
    // step left in the job environment.
    EXTERNAL_RESOLVER: "",
    // Completed engine-side with the compose network's gateway, which does not
    // exist yet here. See lib/host-addresses.ts.
    HOST_ADDRESSES: hostAddresses().join(" "),
  };
}

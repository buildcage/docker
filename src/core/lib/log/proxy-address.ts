/**
 * The gateway the build or step reaches the proxy and its resolver through,
 * and the address CoreDNS answers every name with. A connection sent there was
 * named rather than addressed, so its destination says nothing about which
 * name.
 *
 * init-inspect-cfg echoes it as GATEWAY= and cannot import it, so the test
 * beside this keeps the two in sync. Each action tests its own network's
 * gateway outside core.
 *
 * It sits at the far end of 198.18.0.0/15, the RFC 2544 benchmarking block:
 * outside Docker's default address pools, so no network Docker allocates can
 * overlap it, and unused by real networks, which it would shadow otherwise.
 */
export const PROXY_ADDRESS = "198.19.255.1";

/**
 * The network PROXY_ADDRESS shares with the build's steps. The
 * internal-address guard refuses all of it, so a name resolving to a step
 * cannot make the proxy connect there.
 */
export const PROXY_SUBNET = "198.19.255.0/24";

/** Stands in for the host of a connection sent to PROXY_ADDRESS whose name the
 *  log does not carry. */
export const UNKNOWN_HOST = "(unknown)";

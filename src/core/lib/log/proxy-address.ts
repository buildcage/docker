/**
 * The gateway the build or step reaches the proxy and its resolver through,
 * and the address CoreDNS answers every name with. A connection sent there was
 * named rather than addressed, so its destination says nothing about which
 * name.
 *
 * Whatever hands out that gateway has to use this value. The inspect image's
 * haproxy config generator echoes it as GATEWAY= and cannot import this, so the
 * test beside this holds the two in sync; each action checks its own network
 * (a CNI config, a veth link) with a test of its own outside core.
 *
 * It sits at the far end of 198.18.0.0/15, the RFC 2544 benchmarking block:
 * outside Docker's default address pools, so no network Docker allocates can
 * overlap it, and unused by real networks, which it would shadow otherwise.
 */
export const PROXY_ADDRESS = "198.19.255.1";

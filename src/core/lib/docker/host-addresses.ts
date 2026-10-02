import { networkInterfaces } from "node:os";

interface HostAddressOptions {
  networkInterfaces?: typeof networkInterfaces;
}

/**
 * Every IPv4 address the runner itself holds, refused by the engine as a
 * resolved destination.
 *
 * The guard allows RFC1918 so that a name pointing at an internal mirror keeps
 * working (see INTERNAL_RANGES in core/lib/acl/haproxy-rules.ts). The runner is
 * the one part of RFC1918 that is never a mirror. A published container port
 * answers on every address the runner holds, so the whole list is needed and
 * not just the gateway.
 *
 * Only the runner can see docker0 and the other bridges, which is why this does
 * not run in the container. The compose network's own gateway is missing here
 * and the engine's init script supplies it. Loopback is left to 127.0.0.0/8.
 */
export function listHostIpv4Addresses({
  networkInterfaces: list = networkInterfaces,
}: HostAddressOptions = {}): string[] {
  const found = new Set<string>();
  for (const infos of Object.values(list())) {
    for (const info of infos ?? []) {
      // Node spelled the family as the number 4 before v18.
      if (info.family !== "IPv4" && (info.family as unknown) !== 4) continue;
      if (info.internal) continue;
      found.add(info.address);
    }
  }
  return [...found].sort();
}

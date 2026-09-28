export interface InternalDstOptions {
  /** INTERNAL_RANGES plus the proxy's own network; see haproxy-config.ts. */
  internalAddrs: string[];
  /** The runner's own addresses, ORed into the same acl. */
  hostAddressFile?: string;
}

/**
 * Declare "this destination is internal" for one stage.
 *
 * Both stages guard on the same set, so the acl is written once and only its
 * name differs. What each attaches to it is not shared: the passthrough path
 * rejects a connection, while the inspected path denies a request with 403.
 */
export function internalDstAcl(name: string, opts: InternalDstOptions): string[] {
  return [
    `    acl ${name} var(txn.dst) -m ip ${opts.internalAddrs.join(" ")}`,
    // Repeating an acl name ORs it with the first declaration, leaving the
    // inline list above untouched.
    ...(opts.hostAddressFile
      ? [`    acl ${name} var(txn.dst) -m ip -f ${opts.hostAddressFile}`]
      : []),
  ];
}

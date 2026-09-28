/** What haproxy's termination state says about a request that never arrived
 *  whole, shared by both engines' HTTP stages. */

/**
 * What haproxy logs where the method would be when the bytes it read parsed as
 * no request at all. A client cannot send it: a method is an HTTP token, and
 * `<` and `>` are not token characters, so this is the proxy's own word rather
 * than anything the build chose.
 */
export const BAD_REQUEST_METHOD = "<BADREQ>";

/**
 * What ended a connection before a whole request had arrived, or undefined when
 * one arrived or this proxy is the one that ended it.
 *
 * Phase `R` is the proxy still reading the request line and headers, and both
 * engines' HTTP stages resolve the Host and connect only once one has parsed,
 * so nothing left this proxy. `C` is the client closing and `c` its own timeout
 * expiring, neither of which a rule had a say in. `P` is this proxy answering,
 * which is a decision however little of the request it had, so the caller names
 * it instead. Anything else in that phase is haproxy's own doing, an internal
 * error or a resource it ran out of, and no request arrived then either.
 *
 * A later phase (`CD` and the like) means the rules had already decided on a
 * request, so those stay ordinary exchanges, unless the method says otherwise:
 * a queue, a connection or a transfer cannot be reached without a request, and
 * `<BADREQ>` says none parsed. Nothing in the log makes the two agree, so a
 * line whose own fields contradict each other is counted here rather than
 * believed, or `--` would reach a host table as something allowed.
 */
export function incompleteReason(terminationState: string, method: string): string | undefined {
  const cause = terminationState[0];
  // This proxy answering is a decision however little of the request it had.
  if (cause === "P") return undefined;
  if (terminationState[1] !== "R") {
    return method === BAD_REQUEST_METHOD ? "no-request" : undefined;
  }
  if (cause === "C") return "client-aborted";
  if (cause === "c") return "client-timeout";
  return "no-request";
}

/** What the report learned from asking the proxy before it read the log
 *  (proxy-health.ts). */
export interface ProxyHealth {
  /** False when the proxy did not answer at all: it stopped during the run and
   *  stayed down, or hung. */
  answered: boolean;
  /** The proxy's own dropped-line count, or undefined where it could not be
   *  read or the log did not catch up. */
  droppedLines: number | undefined;
  /** How many times the proxy connected to its log writer, or undefined
   *  where that could not be read. */
  logConnections: number | undefined;
}

/** What the report asks the running proxy container, alongside its logs. */
export interface ServiceHealth {
  proxy: ProxyHealth;
  /** Whether the resolver answered its health check (resolver-health.ts). */
  resolverAnswered: boolean;
  /** How many times the resolver's log writer died, or undefined where that
   *  could not be read (resolver-health.ts). */
  resolverLogDeaths: number | undefined;
}

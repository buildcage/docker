/**
 * Generates and emits the universal engine's outbound-traffic report.
 * Baked into the image and copied out of it (not out of the running
 * container) by the `report` action, which runs it on the runner as
 * `node report-action.js <container-id>`.
 *
 * Reads two logs: the proxy's decisions and the resolver's, the latter being
 * the only trace of a name looked up but never connected to.
 *
 * Everything but those two log paths is src/report/action-main.ts.
 */
import { readProxyDroppedLogs } from "#core/lib/docker/proxy-dropped-logs.ts";
import { readResolverAnswered } from "#core/lib/docker/resolver-health.ts";
import { buildUniversalReportData } from "#core/lib/report/build/universal.ts";
import { readLog, reportActionError, runReportAction } from "#report/action-main.ts";

const PROXY_LOG_DIR = "/var/log/haproxy";
const RESOLVER_LOG_DIR = "/var/log/coredns";

runReportAction({
  proxyEngine: "universal",
  build: (docker, containerId, parameters) => {
    // First: it waits for the proxy's log to catch up before anything reads it.
    const droppedLogs = readProxyDroppedLogs(docker, containerId);
    return buildUniversalReportData(
      readLog(docker, containerId, PROXY_LOG_DIR),
      readLog(docker, containerId, RESOLVER_LOG_DIR),
      parameters,
      { droppedLogs, resolverAnswered: readResolverAnswered(docker, containerId) },
    );
  },
}).catch((e) => {
  console.log(reportActionError(e));
  process.exit(1);
});

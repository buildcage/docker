/**
 * Generates and emits the universal engine's outbound-traffic report.
 * Baked into the image, copied out of it (not out of the running container)
 * by the `report` action on every run, and run with `node report-action.js
 * <container-id>`. Runs on the runner, not inside the container, reaching in
 * via core/lib/docker/client.ts, so `report` itself never needs to know this
 * engine's log paths or env var names.
 *
 * Reads two logs: the proxy's decisions and the resolver's, the latter being
 * the only trace of a name looked up but never connected to.
 *
 * Everything but those two log paths is src/report/action-main.ts.
 */
import { readProxyDroppedLogs } from "#core/lib/docker/proxy-dropped-logs.ts";
import { readRotatedLog } from "#core/lib/docker/rotated-log.ts";
import { runReportAction } from "../../../src/report/action-main.ts";
import { buildUniversalReportData } from "#core/lib/report/build/universal.ts";
import { errorMessage } from "#core/lib/errors.ts";

const PROXY_LOG_DIR = "/var/log/haproxy";
const RESOLVER_LOG_DIR = "/var/log/coredns";

runReportAction({
  proxyEngine: "universal",
  build: (docker, containerId, parameters) =>
    buildUniversalReportData(
      readRotatedLog(docker, containerId, PROXY_LOG_DIR),
      readRotatedLog(docker, containerId, RESOLVER_LOG_DIR),
      parameters,
      readProxyDroppedLogs(docker, containerId),
    ),
  // Now that universal builds a timeline, it can write the traffic artifact too.
  writesTrafficFile: true,
}).catch((e) => {
  console.log(`::error::Unexpected error in report-action: ${errorMessage(e)}`);
  process.exit(1);
});

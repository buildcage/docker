/**
 * Generates and emits the inspect engine's outbound-traffic report.
 *
 * Baked into the image and copied out of it (not out of the running
 * container) by the `report` action, which runs it on the runner as
 * `node report-action.js <container-id>` (see report/src/main.ts). Reads two
 * logs: the proxy's requests and the resolver's refused names, the latter
 * being the only trace of a DNS-only exfiltration.
 *
 * Everything but those two log paths is src/report/action-main.ts.
 */
import { readProxyDroppedLogs } from "#core/lib/docker/proxy-dropped-logs.ts";
import { readRotatedLog } from "#core/lib/docker/rotated-log.ts";
import { runReportAction } from "../../../src/report/action-main.ts";
import { buildInspectReportData } from "#core/lib/report/build/inspect.ts";
import { errorMessage } from "#core/lib/errors.ts";

const PROXY_LOG_DIR = "/var/log/haproxy";
const RESOLVER_LOG_DIR = "/var/log/coredns";

runReportAction({
  proxyEngine: "inspect",
  build: (docker, containerId, parameters) =>
    buildInspectReportData(
      readRotatedLog(docker, containerId, PROXY_LOG_DIR),
      readRotatedLog(docker, containerId, RESOLVER_LOG_DIR),
      parameters,
      readProxyDroppedLogs(docker, containerId),
    ),
  // The only engine with a per-request timeline to write.
  writesTrafficFile: true,
}).catch((e) => {
  console.log(`::error::Unexpected error in report-action: ${errorMessage(e)}`);
  process.exit(1);
});

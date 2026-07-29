import { renderHostTable } from "./host-table.ts";
import { buildRestrictExample } from "./build-example.ts";
import { renderCommunicationDetails } from "./command-log.ts";
import type { ReportData } from "./report-data.ts";

/** Branches on `report.engine`/`report.parameters.mode` rather than being
 *  duplicated per engine. actionRepo/actionRef are real values, not
 *  placeholders — this runs on the runner, with process.env available. */
export function renderReportMarkdown(report: ReportData, actionRepo: string, actionRef: string): string {
  const isAudit = report.parameters.mode === "audit";
  const showExpected = report.parameters.knownBlockedRules.length > 0;
  const heading = isAudit ? "📋 Audited Hosts" : "✅ Allowed Hosts";

  let markdown = `## Outbound Traffic Report during Docker Build (${report.parameters.mode} mode)\n\n`;

  if (report.passed.length > 0) {
    markdown += `### ${heading}\n\n` + renderHostTable(report.passed) + "\n";
  }
  if (isAudit) {
    markdown += buildRestrictExample(report.passed, actionRepo, actionRef);
  }
  if (report.blocked.length > 0) {
    if (report.passed.length > 0) markdown += "\n";
    markdown += "### 🚫 Blocked Hosts\n\n" + renderHostTable(report.blocked, { showReason: true, showExpected }) + "\n";
  }
  if (report.passed.length === 0 && report.blocked.length === 0) {
    // Otherwise a no-traffic build leaves nothing between the heading and the
    // footer — indistinguishable from a report that failed to generate.
    markdown += "_(no communication)_\n\n";
  }

  if (report.engine === "explicit") {
    markdown += renderCommunicationDetails(report.proxyLogs.builds, report.proxyLogs.denied);
  } else {
    // SNI-based sniffing only applies to the transparent engine — the
    // explicit engine terminates TLS itself, so this caveat doesn't apply
    // there (renderCommunicationDetails above covers explicit instead).
    markdown += "\n<sub>*Note: HTTP rules are based on the Host header, HTTPS rules on SNI, and IP rules on the destination IP address.*</sub>\n";
  }

  markdown += `\n*Reported by [Buildcage](https://github.com/${actionRepo})*\n`;
  return markdown;
}

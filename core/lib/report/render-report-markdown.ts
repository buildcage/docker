import { renderHostTable } from "./host-table.ts";
import { buildRestrictExample } from "./build-example.ts";
import { renderCommunicationDetails } from "./command-log.ts";
import type { ReportData } from "./report-data.ts";

/**
 * Renders a ReportData into the Job Summary markdown, branching on
 * `report.engine`/`report.parameters.mode` rather than being duplicated
 * per engine like the two old qjs scripts were. actionRepo/actionRef are
 * the real values (no {{...}} placeholders) — the caller already has them
 * from its own process.env, since this runs on the runner now.
 */
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

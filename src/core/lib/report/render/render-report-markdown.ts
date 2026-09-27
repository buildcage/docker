import type { ReportData } from "../types.ts";
import { buildRestrictExample } from "./build-example.ts";
import { foldExpectedBlockedRows } from "./fold-expected-blocked.ts";
import { renderHostTable } from "./host-table.ts";
import { renderInspectDetails } from "./inspect-details.ts";
import { buildInspectRestrictExample } from "./inspect-example.ts";
import { escapeCell } from "./markdown-table.ts";
import type { ExampleStepOptions } from "./restrict-example.ts";

export interface RenderReportMarkdownOptions extends ExampleStepOptions {
  /** Heading text. May carry untrusted input: the heading escapes it. */
  title?: string;
}

/** Branches on `report.engine`/`report.parameters.mode` rather than being
 *  duplicated per engine. actionRepo/actionRef are real values, not
 *  placeholders: this runs on the runner, with process.env available. */
export function renderReportMarkdown(
  report: ReportData,
  actionRepo: string,
  actionRef: string,
  { title = "Outbound Traffic Report", ...step }: RenderReportMarkdownOptions = {},
): string {
  const isAudit = report.parameters.mode === "audit";
  const showExpected = report.parameters.knownBlockedRules.length > 0;
  const heading = isAudit ? "📋 Audited Hosts" : "✅ Allowed Hosts";

  // restrict is what a real run normally uses day to day, so its heading
  // stays bare; audit is the occasional, deliberately different mode and
  // says so, the same way the heading below calls out "Audited" vs "Allowed".
  // escapeCell keeps an untrusted title from injecting Markdown or a newline.
  let markdown = `## ${escapeCell(title)}${isAudit ? " (audit mode)" : ""}\n\n`;

  // The tables would otherwise read as the whole story.
  if (!report.logLooksPlausible) {
    markdown +=
      "> ⚠️ **This report is incomplete**, so the tables below are not a full record of this run.\n" +
      "> Either the logs don't begin where a real run does, one carries a line that cannot be\n" +
      "> read, or the proxy dropped lines it could not write (or could not say whether it had).\n" +
      "> A missing beginning was either removed or rotated out by traffic heavy enough to fill the\n" +
      "> 100 MB of log kept, which takes a few hundred thousand ordinary requests or a few thousand\n" +
      "> made as long as a request can be.\n\n";
  }

  if (report.passed.length > 0) {
    markdown += `### ${heading}\n\n` + renderHostTable(report.passed) + "\n";
  }
  if (isAudit) {
    // inspect saw the method and the path of every request, so its example
    // can be that much narrower than one built from hosts alone.
    markdown +=
      report.engine === "inspect"
        ? buildInspectRestrictExample(report.timeline, actionRepo, actionRef, {
            ...step,
            allowedIpRules: report.parameters.allowedIpRules,
            allowedTlsRules: report.parameters.allowedTlsRules,
          })
        : buildRestrictExample(report.passed, actionRepo, actionRef, step);
  }
  if (report.blocked.length > 0) {
    if (report.passed.length > 0) markdown += "\n";
    // A folded row names its rule; the hosts it stands for are in the
    // Communication details section, which both engines now emit.
    const blocked = foldExpectedBlockedRows(report.blocked);
    markdown +=
      "### 🚫 Blocked Hosts\n\n" +
      renderHostTable(blocked, { showReason: true, showExpected }) +
      "\n";
  }
  if (report.failed.length > 0) {
    if (report.passed.length > 0 || report.blocked.length > 0) markdown += "\n";
    markdown +=
      "### ⚠️ Failed Connections\n\n" +
      renderHostTable(report.failed, { showReason: true }) +
      "\n\n<sub>*Note: no rule refused these; the connection itself did not complete, so no rule " +
      "can change the outcome and none of them fails the step.*</sub>\n";
  }
  if (
    report.passed.length === 0 &&
    report.blocked.length === 0 &&
    report.failed.length === 0 &&
    report.timeline.length === 0
  ) {
    // Otherwise a no-traffic run leaves nothing between the heading and the
    // footer, indistinguishable from a report that failed to generate. A run
    // that only looked names up has empty tables but a non-empty timeline, so
    // its discovery lookups still show in Communication details below.
    markdown += "_(no communication)_\n\n";
  }

  markdown += renderInspectDetails(report.timeline, report.startedAt);
  if (report.engine === "universal") {
    // Only the universal engine identifies a host this way (see
    // docs/security.md); inspect terminates TLS instead.
    markdown +=
      "\n<sub>*Note: HTTP rules are based on the Host header, HTTPS rules on SNI, and IP rules on the destination IP address.*</sub>\n";
  }

  markdown += `\n*Reported by [${actionRepo}](https://github.com/${actionRepo})*\n`;
  markdown += "\n<hr>\n";
  return markdown;
}

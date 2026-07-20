/**
 * Render aggregated host rows as a GitHub-flavored markdown table. Shared by
 * run/src/lib/report.js and report/src/main.js so both actions' Job Summary
 * tables render identically.
 *
 * @param {{host:string, port:string, ruleType:string, reason?:string, count:number, expected?:boolean}[]} rows
 * @param {{showReason?: boolean, showExpected?: boolean}} [options]
 * @returns {string}
 */
export function markdownTable(rows, { showReason = false, showExpected = false } = {}) {
  const headers = ["Host", "Rule"];
  const aligns = ["---", "---"];
  if (showReason) { headers.push("Reason"); aligns.push("---"); }
  headers.push("Count"); aligns.push("---:");
  if (showExpected) { headers.push("Expected"); aligns.push(":---:"); }

  const lines = [`| ${headers.join(" | ")} |`, `| ${aligns.join(" | ")} |`];
  for (const r of rows) {
    const cells = [`${r.host}:${r.port}`, r.ruleType];
    if (showReason) cells.push(r.reason);
    cells.push(r.count);
    if (showExpected) cells.push(r.expected ? "✅" : "");
    lines.push(`| ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}

const ALIGN_MARKERS = { left: "---", right: "---:", center: ":---:" };
const alignMarker = (align) => ALIGN_MARKERS[align] ?? ALIGN_MARKERS.left;

/**
 * Render a generic GitHub-flavored markdown table.
 *
 * @param {{key: string, title: string, align?: "left"|"right"|"center"}[]} formats
 * @param {Record<string, string|number>[]} rows
 * @returns {string}
 */
export function markdownTable(formats, rows) {
  const headers = formats.map((f) => f.title);
  const aligns = formats.map((f) => alignMarker(f.align));
  const lines = [`| ${headers.join(" | ")} |`, `| ${aligns.join(" | ")} |`];
  for (const row of rows) {
    const cells = formats.map((f) => row[f.key]);
    lines.push(`| ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}

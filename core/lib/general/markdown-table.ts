export type Align = "left" | "right" | "center";

export interface ColumnFormat {
  key: string;
  title: string;
  align?: Align;
}

const ALIGN_MARKERS: Record<Align, string> = { left: "---", right: "---:", center: ":---:" };
const alignMarker = (align?: Align): string => ALIGN_MARKERS[align ?? "left"] ?? ALIGN_MARKERS.left;

/**
 * Render a generic GitHub-flavored markdown table.
 */
export function markdownTable(
  formats: ColumnFormat[],
  rows: Record<string, string | number | undefined>[],
): string {
  const headers = formats.map((f) => f.title);
  const aligns = formats.map((f) => alignMarker(f.align));
  const lines = [`| ${headers.join(" | ")} |`, `| ${aligns.join(" | ")} |`];
  for (const row of rows) {
    const cells = formats.map((f) => row[f.key]);
    lines.push(`| ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}

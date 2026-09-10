export type Align = "left" | "right" | "center";

export interface ColumnFormat {
  key: string;
  title: string;
  align?: Align;
}

const ALIGN_MARKERS: Record<Align, string> = { left: "---", right: "---:", center: ":---:" };
const alignMarker = (align?: Align): string => ALIGN_MARKERS[align ?? "left"] ?? ALIGN_MARKERS.left;

/**
 * A cell's text is attacker-chosen (a host comes from an SNI or a Host header),
 * and an unescaped `|` opens as many extra cells as it likes: a blocked host
 * can push its own "Reason" and "Expected" values into the row. Brackets and
 * angle brackets matter for the same reason, turning a host into a link or raw
 * HTML. `.` and `-` are left alone, being ordinary in a host.
 *
 * A newline would split the row itself, which no backslash can prevent, so it
 * collapses to a space instead.
 */
function escapeCell(value: string | number | undefined): string {
  if (value === undefined) return "";
  return String(value)
    .replace(/[\\`*_[\]<>|]/g, "\\$&")
    .replace(/\r?\n/g, " ");
}

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
    const cells = formats.map((f) => escapeCell(row[f.key]));
    lines.push(`| ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}

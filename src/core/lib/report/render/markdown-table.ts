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
 * angle brackets do the same to what the cell means, turning a host into a link
 * or raw HTML.
 *
 * Emphasis markers (`*`, `_`) are deliberately not escaped. They change nothing
 * but weight, and `_` is what the universal engine substitutes for every
 * character a host may not carry, so escaping it would bury the one row a
 * reviewer reads closely in backslashes.
 *
 * A newline would split the row itself, which no backslash can prevent, so it
 * collapses to a space instead.
 */
function escapeCell(value: string | number | undefined): string {
  if (value === undefined) return "";
  return String(value)
    .replace(/[\\`[\]<>|]/g, "\\$&")
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

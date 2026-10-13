export type Align = "left" | "right" | "center";

export interface ColumnFormat {
  key: string;
  title: string;
  align?: Align;
  /** Show the cell as a code span, for text a request chose. */
  code?: boolean;
}

const ALIGN_MARKERS: Record<Align, string> = { left: "---", right: "---:", center: ":---:" };
const alignMarker = (align?: Align): string => ALIGN_MARKERS[align ?? "left"];

/**
 * Neutralizes the structural Markdown in text so it renders as its literal
 * characters. Shared by the table cells and the report heading (the `label`
 * input); render-report-markdown.ts relies on this exact set. Text a request
 * chose goes in a `code` column instead.
 *
 * An unescaped `|` opens as many extra cells as it likes, pushing values of its
 * own into the row. Brackets and angle brackets do the same to what the cell
 * means, turning text into a link or raw HTML.
 *
 * `*` is escaped because a cell can carry a rule pattern, where `**.example.com:*`
 * would otherwise render as a lone `*` and an emphasized remainder, reading as a
 * different pattern than the one written. `_` is left alone: it emphasizes
 * nothing mid-word.
 *
 * A newline would split the row itself, which no backslash can prevent, so it
 * collapses to a space instead.
 */
export function escapeCell(value: string | number | undefined): string {
  if (value === undefined) return "";
  return String(value)
    .replace(/[\\`[\]<>|*]/g, "\\$&")
    .replace(/\r?\n/g, " ");
}

/**
 * Text as a code span, where Markdown prints as itself. Backslashes cannot do
 * that for a host or URL: GitHub still turns a character reference such as
 * `&ZeroWidthSpace;` into the invisible character it names, `~~` into
 * strikethrough, and a `www.` or `https://` cell into a link that a backslash
 * cuts short.
 */
export function codeSpan(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** GFM still splits a table row on a `|` inside a code span, so that alone is escaped. */
export function codeCell(value: string | number | undefined): string {
  if (value === undefined || value === "") return "";
  return codeSpan(String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " "));
}

export function markdownTable(
  formats: ColumnFormat[],
  rows: Record<string, string | number | undefined>[],
): string {
  const headers = formats.map((f) => f.title);
  const aligns = formats.map((f) => alignMarker(f.align));
  const lines = [`| ${headers.join(" | ")} |`, `| ${aligns.join(" | ")} |`];
  for (const row of rows) {
    const cells = formats.map((f) => (f.code ? codeCell : escapeCell)(row[f.key]));
    lines.push(`| ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}

/**
 * Fits a Job Summary into GitHub Actions' per-step limit: confirmed at exactly
 * 1 MiB (`actions/runner`'s `CreateStepSummaryCommand.AttachmentSizeLimit`).
 * Exceeding it does not truncate on GitHub's side: it silently drops the
 * entire step's summary upload, so a summary that grows too large would
 * otherwise vanish rather than degrade.
 *
 * The summary arrives as blocks in the order they print. When they do not all
 * fit, they are given room by priority instead, so the parts that matter most
 * survive and the long logs give way first.
 */

export const STEP_SUMMARY_LIMIT_BYTES = 1024 * 1024;
// Headroom for byte-counting slop and for the truncation notices themselves,
// so appending a notice can never be what pushes the file over the edge.
const SAFETY_MARGIN_BYTES = 8 * 1024;

export interface SummaryBlock {
  /** Lower is given room first when the summary has to be cut. */
  priority: number;
  /**
   * Depth within its section. Once a block is cut, the deeper blocks of its
   * section print nothing: its notice already says the section was cut.
   */
  level: number;
  section: string;
  text: string;
  /**
   * How the block gives way when it does not fit: `keep` prints it whole
   * regardless (the report's own frame), `lines` cuts it at a line boundary,
   * `atomic` replaces it whole with its notice.
   */
  cut: "keep" | "lines" | "atomic";
  /**
   * Leading lines a `lines` cut must keep, or the whole block gives way to its
   * notice: a table's heading, header row and separator.
   */
  head?: number;
  /** Printed around `text`, cut or not: a `<details>` element's tags. */
  open?: string;
  close?: string;
  /** What a cut block says in place of what it dropped. */
  notice?: string;
}

const bytes = (s: string): number => Buffer.byteLength(s, "utf8");

const whole = (b: SummaryBlock): string => (b.open ?? "") + b.text + (b.close ?? "");

/** The blocks with `notice` on every one a cut can reach. */
export function withNotice(blocks: SummaryBlock[], notice: string): SummaryBlock[] {
  return blocks.map((b) => (b.cut === "keep" ? b : { ...b, notice }));
}

/** The blocks printed whole, as they read with no limit to fit. */
export function joinSummaryBlocks(blocks: SummaryBlock[]): string {
  return blocks.map(whole).join("");
}

/**
 * Returns the blocks joined as they are when they fit. Otherwise gives each
 * room in priority order (document order among equals) out of what is left
 * after `usedBytes` already in the summary, cutting the first that does not
 * fit and every later one that does not either.
 *
 * `limitBytes` is GitHub's limit. A caller passes its own only to say what
 * "too large" means without building something that large: every branch below
 * is reached by the ratio of input to limit, not by the absolute size.
 */
export function fitStepSummary(
  blocks: SummaryBlock[],
  limitBytes: number = STEP_SUMMARY_LIMIT_BYTES,
  usedBytes = 0,
): string {
  const full = blocks.map(whole);
  const all = full.join("");
  let budget = limitBytes - SAFETY_MARGIN_BYTES - usedBytes;
  if (bytes(all) <= budget) return all;

  const out = blocks.map(() => "");
  const cutAt = new Map<string, number>(); // section -> shallowest level cut
  const order = blocks
    .map((_, i) => i)
    .sort((a, b) => blocks[a].priority - blocks[b].priority || a - b);
  for (const i of order) {
    const b = blocks[i];
    if ((cutAt.get(b.section) ?? Infinity) < b.level) continue;
    const size = bytes(full[i]);
    if (b.cut === "keep" || size <= budget) {
      out[i] = full[i];
    } else {
      out[i] = cutBlock(b, Math.max(0, budget));
      cutAt.set(b.section, Math.min(cutAt.get(b.section) ?? Infinity, b.level));
    }
    budget -= bytes(out[i]);
  }
  return out.join("");
}

/**
 * The block cut to `budget`, always at a line boundary, closing a fenced code
 * block left open by the cut, with its notice after what is kept.
 */
function cutBlock(b: SummaryBlock, budget: number): string {
  const notice = b.notice ?? "";
  if (b.cut === "atomic") return notice;
  const open = b.open ?? "";
  const close = b.close ?? "";
  const room = budget - bytes(open) - bytes(close) - bytes(notice);

  let kept = "";
  let usedBytes = 0;
  let count = 0;
  let fenceOpen = false;
  for (const line of b.text.split("\n")) {
    const withNewline = `${line}\n`;
    const lineBytes = bytes(withNewline);
    if (usedBytes + lineBytes > room) break;
    kept += withNewline;
    usedBytes += lineBytes;
    count++;
    if (line.trim().startsWith("```")) fenceOpen = !fenceOpen;
  }
  const head = b.head ?? 0;
  if (count < head) return notice;
  // A cut mid-fence would otherwise turn everything after it (the notice, a
  // closing tag, the rest of the summary) into literal code-block text.
  if (fenceOpen) kept += "```\n";
  // A table runs on into the next line until a blank one ends it.
  if (head > 0) kept += "\n";
  return open + kept + notice + close;
}

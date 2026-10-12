/**
 * Fits a Job Summary into GitHub Actions' per-step limit: confirmed at exactly
 * 1 MiB (`actions/runner`'s `CreateStepSummaryCommand.AttachmentSizeLimit`).
 * Exceeding it does not truncate on GitHub's side: it silently drops the
 * entire step's summary upload, so a summary that grows too large would
 * otherwise vanish rather than degrade.
 *
 * The summary arrives as blocks in the order they print. When they do not all
 * fit, they get room in priority order instead.
 */

export const STEP_SUMMARY_LIMIT_BYTES = 1024 * 1024;
// Headroom for byte-counting slop and for the truncation notices themselves,
// so appending a notice can never be what pushes the file over the edge. A
// caller fitting its own content alongside this module's output leaves the
// same headroom.
export const SAFETY_MARGIN_BYTES = 8 * 1024;

export interface SummaryBlock {
  /** Names the block for its caller, which picks its notice by it. */
  id?: string;
  /**
   * Lower is given room first when the summary has to be cut. A `keep` block
   * is given room before all others whatever its priority.
   */
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

/** A string's length in UTF-8 bytes, the unit the limit is counted in. */
export const bytes = (s: string): number => Buffer.byteLength(s, "utf8");

const rank = (b: SummaryBlock): number => (b.cut === "keep" ? -Infinity : b.priority);

const whole = (b: SummaryBlock): string => (b.open ?? "") + b.text + (b.close ?? "");

/** The blocks with the notice `noticeFor` picks on every one a cut can reach. */
export function withNotices(
  blocks: SummaryBlock[],
  noticeFor: (block: SummaryBlock) => string | undefined,
): SummaryBlock[] {
  return blocks.map((b) => (b.cut === "keep" ? b : { ...b, notice: noticeFor(b) }));
}

/** The blocks printed whole, as they read with no limit to fit. */
export function joinSummaryBlocks(blocks: SummaryBlock[]): string {
  return blocks.map(whole).join("");
}

export interface FitStepSummaryOptions {
  /** What the summary already holds, which counts against the limit too. */
  usedBytes?: number;
  /**
   * GitHub's limit. A test passes its own only to say what "too large" means
   * without building something that large: every branch of the fit is reached
   * by the ratio of input to limit, not by the absolute size.
   */
  limitBytes?: number;
  /** Called with each block the fit truncated or replaced with its notice. */
  onCut?: (block: SummaryBlock) => void;
}

/**
 * Returns the blocks joined as they are when they fit. Otherwise gives each
 * room in priority order (document order among equals) and cuts any that
 * does not fit.
 */
export function fitStepSummary(
  blocks: SummaryBlock[],
  { usedBytes = 0, limitBytes = STEP_SUMMARY_LIMIT_BYTES, onCut }: FitStepSummaryOptions = {},
): string {
  const full = blocks.map(whole);
  const sizes = full.map(bytes);
  let budget = limitBytes - SAFETY_MARGIN_BYTES - usedBytes;
  if (sizes.reduce((sum, n) => sum + n, 0) <= budget) return full.join("");

  const out = blocks.map(() => "");
  const cutAt = new Map<string, number>(); // section -> shallowest level cut
  const order = blocks.map((_, i) => i).sort((a, b) => rank(blocks[a]) - rank(blocks[b]) || a - b);
  for (const i of order) {
    const b = blocks[i];
    if ((cutAt.get(b.section) ?? Infinity) < b.level) continue;
    if (b.cut === "keep" || sizes[i] <= budget) {
      out[i] = full[i];
      budget -= sizes[i];
    } else {
      out[i] = cutBlock(b, Math.max(0, budget));
      budget -= bytes(out[i]);
      cutAt.set(b.section, Math.min(cutAt.get(b.section) ?? Infinity, b.level));
      onCut?.(b);
    }
  }
  return out.join("");
}

/**
 * The block cut to `budget`, always at a line boundary, closing a fenced code
 * block left open by the cut, with its notice after what is kept.
 */
function cutBlock(b: SummaryBlock, budget: number): string {
  const notice = b.notice ?? "";
  // A notice alone keeps the block's opening blank line, which ends the table
  // or </details> above it.
  const alone = (b.text.startsWith("\n") ? "\n" : "") + notice;
  if (b.cut === "atomic") return alone;
  const open = b.open ?? "";
  const close = b.close ?? "";
  const room = budget - bytes(open) - bytes(close) - bytes(notice);

  let kept = "";
  let usedBytes = 0;
  let count = 0;
  let fenceOpen = false;
  // Walk one line at a time rather than splitting the whole block: a tens-of-MB
  // communication log would otherwise array every line to keep only a few. The
  // block always exceeds the budget, so the final piece overflows and the
  // budget check ends the loop without an explicit end-of-text test.
  for (let pos = 0; ;) {
    const nl = b.text.indexOf("\n", pos);
    const line = nl === -1 ? b.text.slice(pos) : b.text.slice(pos, nl);
    const withNewline = `${line}\n`;
    const lineBytes = bytes(withNewline);
    if (usedBytes + lineBytes > room) break;
    kept += withNewline;
    usedBytes += lineBytes;
    count++;
    if (line.trim().startsWith("```")) fenceOpen = !fenceOpen;
    pos = nl + 1;
  }
  // A heading over no rows would read as an empty list, not a cut one.
  const head = b.head ?? 0;
  if (head > 0 && count <= head) return alone;
  // A cut mid-fence would otherwise turn everything after it (the notice, a
  // closing tag, the rest of the summary) into literal code-block text.
  if (fenceOpen) kept += "```\n";
  // A table runs on into the next line until a blank one ends it.
  if (head > 0) kept += "\n";
  return open + kept + notice + close;
}

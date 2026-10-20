import fc from "fast-check";
import { describe, it, expect } from "vitest";

import { fitStepSummary, STEP_SUMMARY_LIMIT_BYTES, type SummaryBlock } from "./fit-step-summary.ts";

/**
 * A straightforward `fitStepSummary`, the oracle for the property below: the
 * optimized one must produce byte-identical output.
 */
const SAFETY_MARGIN_BYTES = 8 * 1024;
const bytes = (s: string): number => Buffer.byteLength(s, "utf8");
const rank = (b: SummaryBlock): number => (b.cut === "keep" ? -Infinity : b.priority);
const whole = (b: SummaryBlock): string => (b.open ?? "") + b.text + (b.close ?? "");

function referenceFit(
  blocks: SummaryBlock[],
  { usedBytes = 0, limitBytes = STEP_SUMMARY_LIMIT_BYTES } = {},
): string {
  const full = blocks.map(whole);
  const all = full.join("");
  let budget = limitBytes - SAFETY_MARGIN_BYTES - usedBytes;
  if (bytes(all) <= budget) return all;

  const out = blocks.map(() => "");
  const cutAt = new Map<string, number>();
  const order = blocks.map((_, i) => i).sort((a, b) => rank(blocks[a]) - rank(blocks[b]) || a - b);
  for (const i of order) {
    const b = blocks[i];
    if ((cutAt.get(b.section) ?? Infinity) < b.level) continue;
    const size = bytes(full[i]);
    if (b.cut === "keep" || size <= budget) {
      out[i] = full[i];
    } else {
      out[i] = referenceCut(b, Math.max(0, budget));
      cutAt.set(b.section, Math.min(cutAt.get(b.section) ?? Infinity, b.level));
    }
    budget -= bytes(out[i]);
  }
  return out.join("");
}

function referenceCut(b: SummaryBlock, budget: number): string {
  const notice = b.notice ?? "";
  const alone = ((b.open || b.text).startsWith("\n") ? "\n" : "") + notice;
  if (b.cut === "atomic") return alone;
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
  if (head > 0 && count <= head) return alone;
  if (fenceOpen) kept += "```\n";
  if (head > 0) kept += "\n";
  return open + kept + notice + close;
}

// Empty, fence, table-row and multibyte lines; the emoji is a surrogate pair,
// so it exercises a multibyte character falling across the budget boundary.
const token = fc.constantFrom(
  "",
  "plain ascii line",
  "x".repeat(40),
  "日本語のテキスト",
  "café résumé",
  "🎉🎊 party",
  "```",
  "```ts",
  "| host.example.com | 200 |",
  "## Heading",
);

const text = fc
  .tuple(fc.array(token, { maxLength: 16 }), fc.boolean())
  .map(([lines, trailingNewline]) => lines.join("\n") + (trailingNewline ? "\n" : ""));

const block: fc.Arbitrary<SummaryBlock> = fc.record({
  id: fc.option(fc.constantFrom("x", "y", "z"), { nil: undefined }),
  priority: fc.integer({ min: 1, max: 6 }),
  level: fc.integer({ min: 1, max: 4 }),
  section: fc.constantFrom("s1", "s2"),
  cut: fc.constantFrom("keep", "lines", "atomic"),
  text,
  head: fc.integer({ min: 0, max: 3 }),
  open: fc.option(fc.constantFrom("\n<details>\n", "\n"), { nil: undefined }),
  close: fc.option(fc.constantFrom("</details>\n", ""), { nil: undefined }),
  notice: fc.option(fc.constantFrom("_cut_\n", "…truncated\n"), { nil: undefined }),
});

describe("fitStepSummary: equivalence with the reference implementation", () => {
  it("matches the oracle byte for byte, cutting at line boundaries", () => {
    fc.assert(
      fc.property(
        fc.array(block, { minLength: 1, maxLength: 5 }),
        // Small limits so the cutting path runs, not the fast path.
        fc.integer({ min: 40, max: 3000 }),
        fc.integer({ min: 0, max: 1500 }),
        (blocks, limitBytes, usedBytes) => {
          const opts = { limitBytes, usedBytes };
          expect(fitStepSummary(blocks, opts)).toBe(referenceFit(blocks, opts));
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("matches the oracle on the default 1 MiB limit", () => {
    fc.assert(
      fc.property(fc.array(block, { minLength: 1, maxLength: 5 }), (blocks) => {
        expect(fitStepSummary(blocks)).toBe(referenceFit(blocks));
      }),
    );
  });
});

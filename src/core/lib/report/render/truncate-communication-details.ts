/**
 * Protects a report's write against GitHub Actions' per-step Job Summary
 * limit: confirmed at exactly 1 MiB (`actions/runner`'s
 * `CreateStepSummaryCommand.AttachmentSizeLimit`). Exceeding it does not
 * truncate on GitHub's side -- it silently drops the *entire* step's summary
 * upload, so a report that grows too large would otherwise vanish rather
 * than degrade.
 *
 * Everything in a report except Communication details is small and fixed in
 * size; only that section scales with how much traffic a build made, so it
 * is the only part ever cut here.
 */

// GitHub's own limit, in bytes.
const STEP_SUMMARY_LIMIT_BYTES = 1024 * 1024;
// Headroom for byte-counting slop and for the truncation notice itself, so
// appending the notice can never be what pushes the file over the edge.
const SAFETY_MARGIN_BYTES = 8 * 1024;

// Both renderers that produce a Communication details section (inspect,
// explicit) open it with this exact literal, and it appears nowhere else in
// a report -- the audit-mode example blocks use <details> too, but without
// this <summary>.
const DETAILS_OPEN = "<details>\n<summary>\u{1F4AC} Communication details</summary>\n\n";
const DETAILS_CLOSE = "</details>\n";

/**
 * Returns `markdown` unchanged when it already fits. Otherwise cuts the
 * Communication details section down to whatever budget is left after every
 * other (fixed-size) part of the report, always at a line boundary, closing
 * a fenced code block left open by the cut and noting that it happened.
 * `artifactAvailable` decides whether that note points at the artifact or
 * suggests turning it on -- it does not fetch or check anything itself.
 */
export function truncateForStepSummary(markdown: string, artifactAvailable: boolean): string {
  if (Buffer.byteLength(markdown, "utf8") <= STEP_SUMMARY_LIMIT_BYTES - SAFETY_MARGIN_BYTES) {
    return markdown;
  }

  const openAt = markdown.indexOf(DETAILS_OPEN);
  if (openAt === -1) return markdown; // Nothing recognized as truncatable.
  const bodyStart = openAt + DETAILS_OPEN.length;
  const closeAt = markdown.indexOf(DETAILS_CLOSE, bodyStart);
  if (closeAt === -1) return markdown;

  const before = markdown.slice(0, bodyStart);
  const body = markdown.slice(bodyStart, closeAt);
  const after = markdown.slice(closeAt);
  const note = truncationNote(artifactAvailable);

  const fixedBytes =
    Buffer.byteLength(before, "utf8") +
    Buffer.byteLength(after, "utf8") +
    Buffer.byteLength(note, "utf8");
  const budget = Math.max(0, STEP_SUMMARY_LIMIT_BYTES - SAFETY_MARGIN_BYTES - fixedBytes);

  let kept = "";
  let usedBytes = 0;
  let fenceOpen = false;
  for (const line of body.split("\n")) {
    const withNewline = `${line}\n`;
    const lineBytes = Buffer.byteLength(withNewline, "utf8");
    if (usedBytes + lineBytes > budget) break;
    kept += withNewline;
    usedBytes += lineBytes;
    if (line.trim().startsWith("```")) fenceOpen = !fenceOpen;
  }
  // A cut mid-fence would otherwise turn everything after it -- the note,
  // </details>, the report's own footer -- into literal code-block text.
  if (fenceOpen) kept += "```\n";

  return before + kept + note + after;
}

function truncationNote(artifactAvailable: boolean): string {
  const rest = artifactAvailable
    ? "the buildcage-traffic artifact uploaded for this run has the rest"
    : "set upload_traffic_artifact: true to get the rest as a downloadable artifact";
  return `_…truncated: the full communication log exceeded GitHub's Job Summary size limit; ${rest}._\n\n`;
}

/**
 * Render the explicit engine's communication detail as a collapsed markdown
 * section. Returns "" if there is nothing to show (including when both
 * inputs are absent/empty, as in transparent mode, which has neither).
 *
 * `builds` (one entry per build found via `buildctl debug histories` — see
 * report/src/lib/vertex-log.js's parseVertexAllowedLog(), called once per
 * ref — oldest build first) is rendered as one block per RUN step, including
 * steps with no communication at all, shown as "(no communication)"; each
 * build's own steps are already grouped by build stage and ordered for human
 * debugging by vertex-log.js, so this function just renders them in the
 * order given. A "### Build N" heading separates builds only when there is
 * more than one — a workflow that runs several builds against the same
 * container before calling the report action once would otherwise repeat
 * step labels like "[2/15] RUN ..." with no indication they're from
 * different builds.
 *
 * `deniedTimeline` (from docker/tools/explicit/report.js's
 * parseDenialTimeline(), which already covers every build since it reads
 * buildkitd's own append-only debug log) is rendered separately, as a flat
 * "DENIED" list with each entry's own timestamp, rather than attributed to a
 * specific RUN step — BuildKit's own denial log carries no vertex/span
 * identifier to attribute it with, so a human has to eyeball the timestamps
 * against the per-step started/duration above to guess which step (and
 * which build) it belongs to.
 *
 * Command/URL text originates in the Dockerfile (or the request itself) and
 * is escaped before being embedded in markdown, so it can't break out of the
 * bold/list formatting it's rendered into.
 *
 * @param {Array<Array<{ command: string, started: string, completed: string, entries: Array<{ method: string, url: string, status?: number }> }>>} builds
 * @param {Array<{ url: string, timestamp: string }>} deniedTimeline
 * @returns {string}
 */
export function renderCommunicationDetails(builds, deniedTimeline) {
  const nonEmptyBuilds = (builds || []).filter((b) => b && b.length > 0);
  const hasVertexLog = nonEmptyBuilds.length > 0;
  const hasDenied = deniedTimeline && deniedTimeline.length > 0;
  if (!hasVertexLog && !hasDenied) return "";

  let md = "\n<details>\n<summary>Communication details</summary>\n\n";

  if (hasVertexLog) {
    const showBuildHeadings = nonEmptyBuilds.length > 1;
    nonEmptyBuilds.forEach((vertices, i) => {
      if (showBuildHeadings) md += `### Build ${i + 1}\n\n`;
      for (const { command, started, completed, entries } of vertices) {
        md += `**${escapeMarkdown(command)}**\n`;
        md += `_started ${formatMillis(started)} · duration ${formatDuration(started, completed)}_\n`;
        if (entries.length === 0) {
          md += "(no communication)\n";
        } else {
          for (const entry of entries) md += `${renderRequestLine(entry)}\n`;
        }
        md += "\n";
      }
    });
  }

  if (hasDenied) {
    md += "**DENIED**\n";
    for (const { url, timestamp } of deniedTimeline) {
      md += `- ${formatSeconds(timestamp)} ${escapeMarkdown(url)}\n`;
    }
    md += "\n";
  }

  md += "</details>\n";
  return md;
}

function renderRequestLine({ method, url, status }) {
  const line = `- ${escapeMarkdown(method)} ${escapeMarkdown(url)}`;
  return status === undefined ? line : `${line} -> ${status}`;
}

// Escapes the markdown syntax characters that could actually alter rendering
// in the contexts this module embeds text into (bold headers, list items,
// italic captions): backslash (escaped first, so it can't double-escape the
// others), backtick (code spans), asterisk/underscore (emphasis — the text
// is already wrapped in "**...**" here, so an embedded one could prematurely
// close it), square brackets and angle brackets (link/autolink/HTML syntax).
// Deliberately narrower than a "full" markdown escaper (e.g. doesn't touch
// "." or "-"), since the text is usually a full URL or shell command and
// over-escaping would make those needlessly hard to read.
function escapeMarkdown(text) {
  return text.replace(/([\\`*_[\]<>])/g, "\\$1");
}

// "HH:MM:SS.mmmZ" — millisecond precision, available for vertex started/
// completed times (from buildctl's rawjson output).
function formatMillis(iso) {
  return new Date(iso).toISOString().slice(11, 23) + "Z";
}

// "HH:MM:SSZ" — whole-second precision only, matching what buildkitd's own
// denial log actually records (no fractional seconds at all); formatting
// this the same way as formatMillis would imply false precision.
function formatSeconds(iso) {
  return new Date(iso).toISOString().slice(11, 19) + "Z";
}

function formatDuration(started, completed) {
  const seconds = (Date.parse(completed) - Date.parse(started)) / 1000;
  return `${seconds.toFixed(3)}s`;
}

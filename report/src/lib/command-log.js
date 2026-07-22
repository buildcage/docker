// @ts-nocheck
/**
 * Render the explicit engine's communication detail as a collapsed markdown
 * section, or "" if there's nothing to show. Allowed Urls is listed before
 * Blocked Urls, matching the Allowed Hosts / Blocked Hosts tables above.
 *
 * Blocked entries aren't attributed to a specific RUN step — buildkitd's
 * denial log carries no vertex/span identifier to attribute it with. A
 * "Build N" item separates builds only when there's more than one, since
 * step labels like "[2/15] RUN ..." repeat across builds.
 *
 * Command text is escaped since it's embedded directly in markdown; request
 * lines go inside a fenced code block instead, where escaping isn't needed.
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

  let md = "\n<details>\n<summary>💬 Communication details</summary>\n\n";

  if (hasVertexLog) {
    md += "* **✅ Allowed Urls**\n\n";
    const showBuildHeadings = nonEmptyBuilds.length > 1;
    nonEmptyBuilds.forEach((vertices, i) => {
      const indent = showBuildHeadings ? "      " : "   ";
      if (showBuildHeadings) md += `   * Build ${i + 1}\n\n`;
      for (const vertex of vertices) md += renderVertexItem(vertex, indent);
    });
  }

  if (hasDenied) {
    md += "* **🚫 Blocked Urls**\n\n";
    for (const { url, timestamp } of deniedTimeline) {
      md += `   - (${formatSeconds(timestamp)}) ${escapeMarkdown(url)}\n`;
    }
    md += "\n";
  }

  md += "</details>\n";
  return md;
}

function renderVertexItem({ command, started, completed, entries }, indent) {
  const inner = indent + "   ";
  let s = `${indent}* ${escapeMarkdown(command)}\n\n`;
  s += `${inner}(${formatSeconds(started)} · duration ${formatDuration(started, completed)})\n\n`;
  s += `${inner}\`\`\`\n`;
  if (entries.length === 0) {
    s += `${inner}(no communication)\n`;
  } else {
    for (const entry of entries) s += `${inner}${renderRequestLine(entry)}\n`;
  }
  s += `${inner}\`\`\`\n\n`;
  return s;
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

// Whole-second precision, matching what buildkitd's own denial log records
// (no fractional seconds) — used for vertex started times too, for consistency.
function formatSeconds(iso) {
  return new Date(iso).toISOString().slice(11, 19) + "Z";
}

function formatDuration(started, completed) {
  const seconds = (Date.parse(completed) - Date.parse(started)) / 1000;
  return `${seconds.toFixed(3)}s`;
}

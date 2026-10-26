import {
  clientEndedNoise,
  connectedHosts,
  isRedundantDns,
  type TrafficEvent,
} from "#core/lib/log/traffic-event.ts";

import { formatElapsedVariable } from "../elapsed-time.ts";
import { redactCredentialQuery } from "./credential-query.ts";

/** The `💬 Communication details` section's own markup. */
export const COMMUNICATION_DETAILS_OPEN =
  "<details>\n<summary>\u{1F4AC} Communication details</summary>\n\n";
export const COMMUNICATION_DETAILS_CLOSE = "</details>\n";

/**
 * What a traffic report says where the Job Summary's size limit cut its
 * communication log. The blank line after it ends the paragraph before the
 * closing tag.
 */
export function communicationTruncationNote(artifactAvailable: boolean): string {
  const rest = artifactAvailable
    ? "the buildcage-traffic artifact uploaded for this run has the rest"
    : "set upload_traffic_artifact: true to get the rest as a downloadable artifact";
  return `_…truncated: the full communication log exceeded GitHub's Job Summary size limit; ${rest}._\n\n`;
}

/**
 * What to print at the end of `event`'s line, or undefined or "" for nothing.
 * It goes on the line inside a fenced block, so it holds no newline.
 */
export type LineNote = (event: TrafficEvent) => string | undefined;

/**
 * The communication detail as a fenced block, or "" if nothing is shown. One
 * timeline, allowed and blocked interleaved. A name lookup is kept only while
 * it is its own sole trace, and dropped once a connection to the same name
 * shows up too. A discovery lookup is always its own sole trace, since nothing
 * connects to `_service._proto.<host>`, and so always shows.
 *
 * A URL keeps its query, except for the parameters named in CREDENTIAL_PARAMS,
 * whose values are replaced.
 */
export function renderCommunicationDetailsBody(
  timeline: TrafficEvent[],
  startedAt: number | undefined,
  lineNote: LineNote = () => undefined,
): string {
  // The keepalive noise clientEndedNoise marks is dropped here, before
  // connectedHosts, so a hidden close cannot mask a name's other rows.
  const isNoise = clientEndedNoise(timeline);
  const relevant = timeline.filter((e) => !isNoise(e));
  const connected = connectedHosts(relevant);
  const shown = relevant.filter((e) => !isRedundantDns(e, connected));
  if (shown.length === 0) return "";
  // A fenced block, so URLs need no markdown escaping and stay copy-pastable.
  const lines = shown.map((event) => renderEvent(event, startedAt, lineNote));
  return `\`\`\`\n${lines.join("\n")}\n\`\`\`\n\n`;
}

// ⚠️ covers what went wrong without a rule blocking it: a request that never
// arrived whole, a connection the origin broke, and a request audit let
// through that restrict would block. The reason or the note tells them
// apart. `discovery` keeps ℹ️: a lookup nothing can answer is harmless.
const MARK: Record<string, string> = {
  block: "🚫",
  discovery: "ℹ️",
  incomplete: "⚠️",
  failed: "⚠️",
};

function renderEvent(
  event: TrafficEvent,
  startedAt: number | undefined,
  lineNote: LineNote,
): string {
  const mark =
    event.action === "audit" && event.wouldBlock !== undefined
      ? "⚠️"
      : (MARK[event.action] ?? "✅");
  const note = event.wouldBlock === undefined ? "" : ` (restrict would block: ${event.wouldBlock})`;
  const extra = lineNote(event);
  const tail = extra ? ` ${extra}` : "";
  return `${mark} ${formatTime(event.time, startedAt)}: ${subject(event)} -> ${outcome(event)}${note}${tail}`;
}

/** What was asked for, in the most specific form available. */
function subject(event: TrafficEvent): string {
  // The type is what tells a fallback nobody notices from an outright failure.
  if (event.queryType !== undefined) return `DNS ${event.queryType} ${event.host}`;
  if (event.protocol === "dns") return `DNS ${event.host}`;
  // A passthrough is never decrypted and a connection that delivered no whole
  // request has nothing to show, so for both a name and a port is all there is.
  // Not written as a URL: that would drop a non-default port.
  if (event.url === undefined) {
    // A blocked name reached for over no connection has no port; universal's
    // coarse events otherwise always carry one.
    const authority = event.port === undefined ? event.host : `${event.host}:${event.port}`;
    const nameAndPort = `${event.protocol.toUpperCase()} ${authority}`;
    // A method means the request arrived whole and only its target fits no URL
    // (`OPTIONS *`; see log/inspect.ts's urlOf); without it the line would read
    // as a connection that carried no request. The log does not record which
    // form the target took, so it is not named.
    return event.method === undefined ? nameAndPort : `${event.method} ${nameAndPort}`;
  }
  return `${event.method} ${redactCredentialQuery(event.url)}`;
}

/** What came of it: a block names its reason, anything else its result. */
function outcome(event: TrafficEvent): string {
  if (event.action === "block") return event.reason ?? "blocked";
  // No status behind one, and the reason tells a close from a timeout and both
  // from bytes that never parsed.
  if (event.action === "incomplete") return event.reason ?? "no request";
  // Allowed, then broken: the reason names what broke.
  if (event.action === "failed") return event.reason ?? "failed";
  if (event.action === "discovery") return `no data (${event.queryType} is never served)`;
  const parts: string[] = [];
  if (event.status !== undefined) parts.push(String(event.status));
  if (event.bytes !== undefined) parts.push(`(${formatBytes(event.bytes)})`);
  // A name that resolved has neither, and saying so is the whole entry.
  return parts.length > 0 ? parts.join(" ") : "resolved";
}

/**
 * Elapsed since the proxy started, to the millisecond: several requests
 * routinely land in the same second. Absolute UTC when there is no start time.
 */
function formatTime(epochSeconds: number, startedAt: number | undefined): string {
  if (startedAt === undefined) {
    return new Date(epochSeconds * 1000).toISOString().slice(11, 23) + "Z";
  }
  return formatElapsedVariable(epochSeconds - startedAt);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

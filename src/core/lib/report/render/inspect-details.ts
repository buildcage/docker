import {
  clientEndedNoise,
  connectedHosts,
  isRedundantDns,
  type TrafficEvent,
} from "#core/lib/log/traffic-event.ts";

import { formatElapsedVariable } from "../elapsed-time.ts";
import { wrapCommunicationDetails } from "./communication-section.ts";

/**
 * Render the communication detail as a collapsed markdown section, or "" if
 * empty. One timeline, allowed and refused interleaved. A name lookup is kept
 * only while it is its own sole trace, and dropped once a connection to the
 * same name shows up too. A discovery lookup is always its own sole trace,
 * since nothing connects to `_service._proto.<host>`, and so always shows.
 *
 * A URL keeps its query, except for the parameters named in
 * CREDENTIAL_PARAMS, whose values are replaced.
 */
export function renderInspectDetails(
  timeline: TrafficEvent[],
  startedAt: number | undefined,
): string {
  const body = renderInspectDetailsBody(timeline, startedAt);
  return body ? wrapCommunicationDetails(body) : "";
}

/** The section's body alone, a fenced block, or "" if nothing is shown. */
export function renderInspectDetailsBody(
  timeline: TrafficEvent[],
  startedAt: number | undefined,
): string {
  // The keepalive noise clientEndedNoise marks is dropped here, before
  // connectedHosts, so a hidden close cannot mask a name's other rows.
  const isNoise = clientEndedNoise(timeline);
  const relevant = timeline.filter((e) => !isNoise(e));
  const connected = connectedHosts(relevant);
  const shown = relevant.filter((e) => !isRedundantDns(e, connected));
  if (shown.length === 0) return "";

  const body = shown.map((event) => renderEvent(event, startedAt)).join("\n") + "\n";
  // A fenced block, so URLs need no markdown escaping and stay copy-pastable.
  return `\`\`\`\n${body}\`\`\`\n\n`;
}

// ⚠️ covers both of the outcomes no rule decided that went wrong: a request
// that never arrived whole, and a connection the origin broke. The reason
// tells them apart. `discovery` keeps ℹ️: a lookup nothing can answer is
// harmless.
const MARK: Record<string, string> = {
  block: "🚫",
  discovery: "ℹ️",
  incomplete: "⚠️",
  failed: "⚠️",
};

function renderEvent(event: TrafficEvent, startedAt: number | undefined): string {
  const mark = MARK[event.action] ?? "✅";
  return `${mark} ${formatTime(event.time, startedAt)}: ${subject(event)} -> ${outcome(event)}`;
}

/**
 * Query parameters whose value is a credential often enough that printing it
 * is the greater risk: a presigned URL's signature or an API key reaches
 * everyone who can read the run, and GitHub masks only values registered as
 * workflow secrets.
 *
 * Matched on the name alone, ignoring case, `-` and `_`, so a parameter this
 * does not name keeps its value. That covers most of what a refused request
 * was trying to send, but not an exfiltration payload the sender happened to
 * call `code` or `key`; the traffic artifact and the proxy's own log keep every
 * value verbatim, and are where a suspected payload is read.
 */
const CREDENTIAL_PARAMS = new Set([
  "accesskey",
  "accesstoken",
  "apikey",
  "apitoken",
  "auth",
  "authorization",
  "authtoken",
  "clientsecret",
  "code",
  "credential",
  "credentials",
  "idtoken",
  "jwt",
  "key",
  "passwd",
  "password",
  "pat",
  "privatetoken",
  "pwd",
  "refreshtoken",
  "secret",
  "session",
  "sessiontoken",
  "sig",
  "signature",
  "subscriptionkey",
  "token",
  "xamzsecuritytoken",
  "xamzsignature",
  "xapikey",
  "xgoogsignature",
]);

/** `api-key`, `api_key`, `apiKey` and `APIKEY` all read as one name. */
function credentialName(name: string): string {
  return name.toLowerCase().replace(/[-_]/g, "");
}

/**
 * A parameter name within one `&`-separated part: at its start, after the `;`
 * some servers split on too, or after a later `?`, which opens the query of a
 * URL carried in a value.
 */
const PARAM_NAME = /(^|[;?])([^;?=]*)=/g;

/**
 * One `&`-separated part with its first credential's value replaced through to
 * the part's end, since a `;` or `?` after it may be part of the secret.
 */
function redactPart(part: string): string {
  for (const match of part.matchAll(PARAM_NAME)) {
    if (!CREDENTIAL_PARAMS.has(credentialName(match[2]))) continue;
    const value = match.index + match[0].length;
    return value === part.length ? part : `${part.slice(0, value)}***`;
  }
  return part;
}

/**
 * The URL with those values replaced and everything else left alone, so the
 * host, the path and the parameter names still read as they were sent. An
 * empty value stays empty rather than becoming `***`, which would claim a
 * secret that was never there.
 */
function redactCredentialQuery(url: string): string {
  const start = url.indexOf("?");
  if (start === -1) return url;
  const hash = url.indexOf("#", start);
  const end = hash === -1 ? url.length : hash;

  const query = url
    .slice(start + 1, end)
    .split("&")
    .map(redactPart)
    .join("&");

  return url.slice(0, start + 1) + query + url.slice(end);
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
    // A refused name reached for over no connection has no port; universal's
    // coarse events otherwise always carry one.
    const authority = event.port === undefined ? event.host : `${event.host}:${event.port}`;
    const nameAndPort = `${event.protocol.toUpperCase()} ${authority}`;
    // Unless a method did arrive: the request was then whole, and it is its
    // target that no URL fits (`OPTIONS *`; see log/inspect.ts's urlOf).
    // Dropping the method would read as a connection that carried no request.
    // The log records only that there was no path, not which other form the
    // target took, so naming the form here would be a guess.
    return event.method === undefined ? nameAndPort : `${event.method} ${nameAndPort}`;
  }
  return `${event.method} ${redactCredentialQuery(event.url)}`;
}

/** What came of it: a refusal names its reason, anything else its result. */
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
  if (event.wouldRefuse !== undefined) parts.push(`(restrict would refuse: ${event.wouldRefuse})`);
  // A name that resolved has neither, and saying so is the whole entry.
  return parts.length > 0 ? parts.join(" ") : "resolved";
}

/**
 * Elapsed since the proxy started, to the millisecond: several requests
 * routinely land in the same second, and only this engine's log carries the
 * resolution to tell them apart. Falls back to absolute UTC only when there
 * is no start time to be relative to.
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

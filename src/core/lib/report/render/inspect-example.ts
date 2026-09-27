/**
 * Turns what an `audit` run observed into `allowed_url_rules` for a `restrict`
 * run, the engine's reason for existing: which URLs `npm install` reaches
 * cannot be known in advance.
 *
 * A generated rule must never permit more than was observed:
 *
 * - Hosts are enumerated, never generalised into `*.example.com`: the
 *   resolver's scope follows these patterns, so a widened host is leakable.
 * - Methods are listed exactly, never `*`.
 * - A path keeps its longest unchanging prefix; only what varied becomes
 *   `**`, and a single observed path stays exact.
 *
 * A host reached at many unrelated paths therefore collapses to `/**`, the
 * honest answer, since clustering would invent permissions nobody observed. The
 * rule still constrains the method, which no host-level rule can.
 *
 * The method, the `Host` header and the path are the build's or step's to choose, so a
 * request whose method, host or path a rule would read as a pattern is left
 * out of the rules and listed beside them instead.
 */

import { DEFAULT_PORT, splitHostPort } from "#core/lib/log/authority.ts";
import type { TrafficEvent } from "#core/lib/log/traffic-event.ts";

import { markdownTable } from "./markdown-table.ts";
import {
  exampleStepHead,
  restrictExampleBlock,
  type ExampleStepOptions,
} from "./restrict-example.ts";

/** Conventional ordering, so a rule reads the way a person would write it. */
const METHOD_ORDER = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

interface ParsedRequest {
  /** `https://host` or `https://host:9443`: what a rule is written against. */
  origin: string;
  method: string;
  /** Path only. The query is deliberately dropped: rules match the path, and
   *  a recorded query is as likely to hold a one-off token as anything
   *  reusable. */
  path: string;
}

/** A request no rule can be written from without permitting more than it. */
interface LeftOutRequest {
  method: string;
  /** Without its query, for the same reason ParsedRequest.path drops it. */
  url: string;
  /** The part a rule would have read as a pattern. */
  part: "method" | "host" | "path";
}

// `*` and `|` in a method list, and `*` and `?` in a host or a path, are rule
// syntax. A host is also held to non-empty labels, so a pasted rule can't fail
// to compile. A path's `?` never gets this far: it starts the dropped query.
const LITERAL_METHOD = /^[A-Z]+$/;
const LITERAL_HOST = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;

function parseRequest(request: TrafficEvent): ParsedRequest | LeftOutRequest | null {
  if (request.url === undefined || request.method === undefined || request.port === undefined) {
    return null;
  }
  // The authority runs to the first `/`, not to a `?` or `#`: log/inspect.ts
  // joins the `Host` header to a target that always starts with one, so either
  // character before it came from the header.
  const match = /^(https?):\/\/([^/]*)([^?#]*)/.exec(request.url);
  if (!match) return null;
  const [, scheme, authority, target] = match;
  const { host } = splitHostPort(authority);
  const path = target || "/";

  const part = !LITERAL_METHOD.test(request.method)
    ? "method"
    : !LITERAL_HOST.test(host)
      ? "host"
      : path.includes("*")
        ? "path"
        : undefined;
  if (part) return { method: request.method, url: `${scheme}://${authority}${path}`, part };

  // The port the request was sent to, which is what a rule's port is matched
  // against. The one in the `Host` header is the build's or step's to write.
  const port = String(request.port);
  // Drop a port the scheme already implies, so the common case reads plainly.
  const origin =
    port === DEFAULT_PORT[scheme] ? `${scheme}://${host}` : `${scheme}://${host}:${port}`;

  return { origin, method: request.method, path };
}

/** The segments every path shares, from the left. */
function commonPrefixSegments(paths: string[]): string[] {
  // Two or more: pathPatternsFor has already answered the shorter cases.
  const split = paths.map((p) => p.split("/").filter((s) => s !== ""));
  let prefix = split[0];
  for (const segments of split.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < segments.length && prefix[i] === segments[i]) i++;
    prefix = prefix.slice(0, i);
  }
  return prefix;
}

/**
 * The path patterns covering one group of observed paths.
 *
 * Usually one. A second is needed when the shared prefix is itself one of the
 * observed paths: `/express/**` does not match `/express`, so a build or step that
 * fetched both a package's metadata and its tarball needs both spelled out.
 */
export function pathPatternsFor(paths: Iterable<string>): string[] {
  const distinct = [...new Set(paths)].sort();
  if (distinct.length === 0) return [];
  if (distinct.length === 1) return distinct;

  const prefix = commonPrefixSegments(distinct);
  // `/**` already covers `/`, so the root case never needs a second pattern.
  if (prefix.length === 0) return ["/**"];

  const base = `/${prefix.join("/")}`;
  const patterns = [`${base}/**`];
  if (distinct.includes(base)) patterns.unshift(base);
  return patterns;
}

function sortMethods(methods: Iterable<string>): string[] {
  return [...new Set(methods)].sort((a, b) => {
    const ai = METHOD_ORDER.indexOf(a);
    const bi = METHOD_ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a < b ? -1 : 1;
  });
}

/**
 * Build the rule lines, one per emitted rule, in a stable order.
 *
 * Grouping is by origin and method first, so a path that only a POST reached
 * cannot become reachable by GET. Groups that end up with the same pattern are
 * then merged back into one rule with a method list, which is what keeps
 * `GET|HEAD` on one line instead of two.
 */
export function buildUrlRuleLines(requests: TrafficEvent[]): string[] {
  return ruleLinesFrom(partitionRequests(requests).writable);
}

/**
 * The requests a rule can be written from, and the distinct ones it can't, in
 * the order first seen.
 */
function partitionRequests(requests: TrafficEvent[]): {
  writable: ParsedRequest[];
  leftOut: LeftOutRequest[];
} {
  const writable: ParsedRequest[] = [];
  const leftOut = new Map<string, LeftOutRequest>();
  // Only what the build or step actually reached: a refused request is not a rule to
  // reproduce, and a passthrough or a name lookup has no URL to write one from.
  // One that failed at the origin is kept: the rules did permit it and the
  // build or step will ask again, so leaving it out would write an allowlist that
  // breaks the next run.
  for (const request of requests) {
    if (request.action === "block") continue;
    const parsed = parseRequest(request);
    if (!parsed) continue;
    if ("part" in parsed) leftOut.set(`${parsed.method} ${parsed.url}`, parsed);
    else writable.push(parsed);
  }
  return { writable, leftOut: [...leftOut.values()] };
}

function ruleLinesFrom(requests: ParsedRequest[]): string[] {
  const byOriginMethod = new Map<string, { origin: string; method: string; paths: string[] }>();
  for (const parsed of requests) {
    const key = `${parsed.origin}\t${parsed.method}`;
    const group = byOriginMethod.get(key);
    if (group) group.paths.push(parsed.path);
    else
      byOriginMethod.set(key, {
        origin: parsed.origin,
        method: parsed.method,
        paths: [parsed.path],
      });
  }

  // origin + pattern -> the methods that produced it
  const byPattern = new Map<string, { origin: string; pattern: string; methods: string[] }>();
  for (const { origin, method, paths } of byOriginMethod.values()) {
    for (const pattern of pathPatternsFor(paths)) {
      const key = `${origin}\t${pattern}`;
      const entry = byPattern.get(key);
      if (entry) entry.methods.push(method);
      else byPattern.set(key, { origin, pattern, methods: [method] });
    }
  }

  return [...byPattern.values()]
    .sort((a, b) =>
      a.origin < b.origin ? -1 : a.origin > b.origin ? 1 : a.pattern < b.pattern ? -1 : 1,
    )
    .map(({ origin, pattern, methods }) => `${sortMethods(methods).join("|")} ${origin}${pattern}`);
}

/** Enough to show what was left out, and few enough that a build or step sending
 *  thousands can't crowd the rest of the summary out. */
const LEFT_OUT_LIMIT = 20;

/** The requests left out of the rules, as a table under the snippet. */
function leftOutSection(leftOut: LeftOutRequest[]): string {
  const shown = leftOut.slice(0, LEFT_OUT_LIMIT);
  let md =
    "Left out of the rules above: a rule would read part of each request as a pattern, " +
    "and so permit more than was sent.\n\n";
  md += markdownTable(
    [
      { key: "method", title: "Method" },
      { key: "url", title: "URL" },
      { key: "part", title: "Read as a pattern" },
    ],
    shown.map((r) => ({ ...r })),
  );
  md += "\n\n";
  if (leftOut.length > shown.length) {
    md += `…and ${leftOut.length - shown.length} more, listed in Communication details.\n\n`;
  }
  return md;
}

export interface BuildInspectRestrictExampleOptions extends ExampleStepOptions {
  /** Not derived from `requests`: a passthrough is never decrypted, so there
   *  is nothing in the traffic to build these from. They are the same values
   *  the audit run was configured with, echoed back as-is,
   *  since they apply unchanged under `restrict` (only enforcement
   *  differs). */
  allowedIpRules?: string[];
  allowedTlsRules?: string[];
}

/**
 * Render the rules as a collapsed markdown section, or "" if there is
 * nothing to show.
 *
 * `actionRef` is the ref this action was invoked with.
 */
export function buildInspectRestrictExample(
  requests: TrafficEvent[] | null | undefined,
  actionRepo: string,
  actionRef?: string,
  { allowedIpRules = [], allowedTlsRules = [], ...step }: BuildInspectRestrictExampleOptions = {},
): string {
  const { writable, leftOut } = partitionRequests(requests ?? []);
  const lines = ruleLinesFrom(writable);
  if (
    lines.length === 0 &&
    leftOut.length === 0 &&
    allowedIpRules.length === 0 &&
    allowedTlsRules.length === 0
  ) {
    return "";
  }

  let yaml = exampleStepHead(actionRepo, actionRef, step);
  yaml += "    proxy_mode: restrict\n";
  // A literal block, not a folded one: a URL rule contains a space, so the
  // rules are separated by newlines and folding would join them into one.
  if (lines.length > 0) {
    yaml += "    allowed_url_rules: |\n";
    for (const line of lines) yaml += `      ${line}\n`;
  }
  if (allowedTlsRules.length > 0) {
    yaml += "    allowed_tls_rules: |\n";
    for (const rule of allowedTlsRules) yaml += `      ${rule}\n`;
  }
  if (allowedIpRules.length > 0) {
    yaml += "    allowed_ip_rules: |\n";
    for (const rule of allowedIpRules) yaml += `      ${rule}\n`;
  }

  return restrictExampleBlock(yaml, {
    appendix: leftOut.length > 0 ? leftOutSection(leftOut) : undefined,
    footnote: "Permits exactly what this build did; a versioned or dated URL may drift.",
  });
}

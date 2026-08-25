/**
 * Turns what an `audit` run observed into `allowed_url_rules` for a `restrict`
 * run, the engine's reason for existing: which URLs `npm install` reaches
 * cannot be known in advance.
 *
 * A generated rule must never permit more than was observed:
 *
 * - **Hosts are enumerated, never generalised** into `*.example.com`: the
 *   resolver's scope follows these patterns, so a widened host is leakable.
 * - **Methods are listed exactly**, never `*`.
 * - **A path keeps its longest unchanging prefix**; only what varied becomes
 *   `**`, and a single observed path stays exact.
 *
 * A host reached at many unrelated paths therefore collapses to `/**` -- the
 * honest answer, since clustering would invent permissions nobody observed. The
 * rule still constrains the method, which no host-level rule can.
 */

import type { TrafficEvent } from "#core/lib/log/traffic-event.ts";

/** Ports a URL rule may leave unwritten, because the scheme implies them. */
const DEFAULT_PORT: Record<string, string> = { https: "443", http: "80" };

/** Conventional ordering, so a rule reads the way a person would write it. */
const METHOD_ORDER = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

interface ParsedRequest {
  /** `https://host` or `https://host:9443` — what a rule is written against. */
  origin: string;
  method: string;
  /** Path only. The query is deliberately dropped: rules match the path, and
   *  a recorded query is as likely to hold a one-off token as anything
   *  reusable. */
  path: string;
}

function parseRequest(request: TrafficEvent): ParsedRequest | null {
  if (request.url === undefined || request.method === undefined) return null;
  const match = /^(https?):\/\/([^/?#]+)([^?#]*)/.exec(request.url);
  if (!match) return null;
  const [, scheme, authority, rawPath] = match;

  // Drop a port the scheme already implies, so the common case reads plainly.
  const colon = authority.lastIndexOf(":");
  const port = colon > 0 ? authority.slice(colon + 1) : "";
  const origin =
    port && port === DEFAULT_PORT[scheme]
      ? `${scheme}://${authority.slice(0, colon)}`
      : `${scheme}://${authority}`;

  return { origin, method: request.method, path: rawPath || "/" };
}

/** The segments every path shares, from the left. */
function commonPrefixSegments(paths: string[]): string[] {
  const split = paths.map((p) => p.split("/").filter((s) => s !== ""));
  if (split.length === 0) return [];
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
 * observed paths: `/express/**` does not match `/express`, so a build that
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
    return a < b ? -1 : a > b ? 1 : 0;
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
  // Only what the build actually reached: a refused request is not a rule to
  // reproduce, and a passthrough or a name lookup has no URL to write one from.
  const byOriginMethod = new Map<string, { origin: string; method: string; paths: string[] }>();
  for (const request of requests) {
    if (request.action === "block") continue;
    const parsed = parseRequest(request);
    if (!parsed) continue;
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

/**
 * Render the rules as a collapsed markdown section, or "" if nothing was
 * observed.
 *
 * `actionRef` is the ref this action was invoked with. A 40-character SHA is
 * specific to this run and opaque to the reader, so it is shown as a
 * placeholder; a tag is stable and useful as written.
 */
export function buildInspectRestrictExample(
  requests: TrafficEvent[] | null | undefined,
  actionRepo: string,
  actionRef?: string,
): string {
  const lines = buildUrlRuleLines(requests ?? []);
  if (lines.length === 0) return "";

  const ref = actionRef && /^[0-9a-f]{40}$/i.test(actionRef) ? "<sha>" : actionRef;

  let yaml = "- name: Start Buildcage in restrict mode\n";
  yaml += `  uses: ${actionRepo}@${ref}\n`;
  yaml += "  with:\n";
  yaml += "    proxy_mode: restrict\n";
  yaml += "    proxy_engine: inspect\n";
  // A literal block, not a folded one: a URL rule contains a space, so the
  // rules are separated by newlines and folding would join them into one.
  yaml += "    allowed_url_rules: |\n";
  for (const line of lines) yaml += `      ${line}\n`;

  let md = "\n<details>\n";
  md += "<summary>🛡️ Switch to restrict mode</summary>\n\n";
  md += "```yaml\n";
  md += yaml;
  md += "```\n\n";
  md +=
    "These rules permit exactly what this build did, so read them before using them: a URL that\n";
  md += "carried a version or a date will not match the next run, and anything reached through\n";
  md += "`allow_tls_rules` or `allowed_ip_rules` is not here, because it was never inspected.\n\n";
  md += "</details>\n";
  return md;
}

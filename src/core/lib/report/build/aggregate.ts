import { convertUrlRule, DEFAULT_PORT, type UrlRule } from "#core/lib/acl/url-rules.ts";
import {
  completeRulePort,
  convertRule,
  isKnownBlockedUrlRule,
} from "#core/lib/acl/wildcard-rules.ts";
import {
  aggregate,
  compareAggregated,
  entryKey,
  type AggregatedEntry,
  type LogEntry,
} from "#core/lib/log/aggregate.ts";
import { connectedHosts, isRedundantDns, type TrafficEvent } from "#core/lib/log/traffic-event.ts";

export interface AnnotatedBlockedRow extends AggregatedEntry {
  expected: boolean;
  /** The rule that matched, port-completed, for the report to group rows by.
   *  Undefined exactly when `expected` is false. */
  expectedBy?: string;
}

export interface ExpectedFlag {
  expected: boolean;
}

/** A compiled known_blocked_rules rule and the text a row it covers is grouped
 *  under. */
interface KnownBlockedMatcher {
  /** Port-completed for a host rule, exactly as written for a URL rule. */
  rule: string;
  matches(event: TrafficEvent): boolean;
}

/**
 * What a host rule is tested against, normally `host:port`.
 *
 * A block with no port is a refused name, connected to nothing. It is tested as
 * port 0, which `host:*` matches (compiling to `host:\d+`) but `host:443` does
 * not, which is right since no port was involved. Without this a refused name
 * could never be marked expected.
 */
function targetOf(event: TrafficEvent): string {
  return `${event.host}:${event.port === undefined ? "0" : event.port}`;
}

/**
 * The path a request named, without its query string: what a URL rule's path
 * regex is matched against, since HAProxy's `path` fetch drops the query too.
 *
 * event.url is always `scheme://authority/path[?query]` (see urlOf, which
 * builds one only for an origin-form target starting with `/`), so the path
 * begins at the first `/` after the `://`.
 */
function requestPath(url: string): string {
  const pathAndQuery = url.slice(url.indexOf("/", url.indexOf("://") + 3));
  const query = pathAndQuery.indexOf("?");
  return query === -1 ? pathAndQuery : pathAndQuery.slice(0, query);
}

/** A URL rule with its regexes compiled once, for matchesUrlRule. */
interface CompiledUrlRule {
  rule: UrlRule;
  /** `authorityRegex` for a wildcard rule, `hostRegex` for a `~` rule. */
  hostRe: RegExp;
  pathRe: RegExp;
}

/**
 * Whether a blocked event is one a URL rule acknowledges.
 *
 * Only `inspect` records a method and a URL on a block, so an event without
 * them (a host-level refusal, or any block under `universal`) never matches a
 * URL rule; those are acknowledged with a host rule instead. Scheme, host, port
 * and path are matched as the proxy would (see haproxy-rule-block.ts and
 * haproxy-rules.ts's per-scheme bucketing): port and scheme against the
 * connection, not the Host header, so an https rule does not cover a plaintext
 * request and `host:9443` does not cover 443; the path with its query dropped.
 */
function matchesUrlRule({ rule, hostRe, pathRe }: CompiledUrlRule, event: TrafficEvent): boolean {
  if (event.method === undefined || event.url === undefined) return false;
  const scheme = rule.schemes.find((s) => s === event.protocol);
  if (scheme === undefined) return false;
  if (rule.methods !== null && !rule.methods.includes(event.method.toUpperCase())) return false;
  if (!pathRe.test(requestPath(event.url))) return false;
  const hostPort = `${event.host}:${event.port}`;
  if (rule.isRegex) {
    // A `~` rule's port is optional: the proxy tries the host bare on the
    // scheme's default port and with the real port, so both are tried here.
    const defaultPort = Number(DEFAULT_PORT[scheme]);
    return (event.port === defaultPort && hostRe.test(event.host)) || hostRe.test(hostPort);
  }
  return hostRe.test(hostPort);
}

/**
 * Compile the known_blocked_rules lines into matchers, once per report. A line
 * carrying a space is a URL rule (see isKnownBlockedUrlRule); otherwise it is a
 * host rule, whose missing port is completed here too so a value set straight
 * in the environment behaves like one that came through the action's input, and
 * `rule` reports the completed text rather than the shorthand. Each rule's
 * regexes are compiled here, not per event. Hosts match case-insensitively and
 * paths case-sensitively, as the proxy's own rules do.
 */
function buildMatchers(knownBlockedRules: string[]): KnownBlockedMatcher[] {
  return knownBlockedRules.map((line) => {
    if (isKnownBlockedUrlRule(line)) {
      const urlRule = convertUrlRule(line);
      const compiled: CompiledUrlRule = {
        rule: urlRule,
        hostRe: new RegExp(urlRule.isRegex ? urlRule.hostRegex : urlRule.authorityRegex, "i"),
        pathRe: new RegExp(urlRule.pathRegex),
      };
      return { rule: urlRule.raw, matches: (event) => matchesUrlRule(compiled, event) };
    }
    const completed = completeRulePort(line);
    const re = new RegExp(convertRule(completed), "i");
    return { rule: completed, matches: (event) => re.test(targetOf(event)) };
  });
}

/** A blocked-hosts row being built up event by event. */
interface BlockedAccumulator {
  entry: LogEntry;
  count: number;
  /** Every event under this row matched some rule so far. */
  expectedAll: boolean;
  /** The earliest-written matching rule seen, and its index for the tie-break. */
  bestIndex: number;
  bestRule: string | undefined;
}

/**
 * Aggregate blocked events into the report's blocked-hosts rows, tagging each
 * row with whether known_blocked_rules accounts for it and the rule that did.
 *
 * Matching is per event, not per aggregated row: a URL rule marks one request
 * to a host and not another, so a row (which counts several requests to one
 * `host:port`) is expected only when every event under it matched some rule.
 * `expectedBy` is the earliest-written rule that matched any of the row's
 * events, which the report groups the row under; see foldExpectedBlockedRows.
 *
 * knownBlockedRules is as returned by parseAndValidateKnownBlockedRules.
 */
export function annotateKnownBlocked(
  blockedEvents: TrafficEvent[],
  knownBlockedRules: string[],
): AnnotatedBlockedRow[] {
  const matchers = buildMatchers(knownBlockedRules);
  const accumulators = new Map<string, BlockedAccumulator>();
  for (const event of blockedEvents) {
    const entry = toHostRow(event);
    const index = matchers.findIndex((matcher) => matcher.matches(event));
    const key = entryKey(entry);
    const accumulator = accumulators.get(key);
    if (accumulator) {
      accumulator.count++;
      if (index === -1) accumulator.expectedAll = false;
      else if (index < accumulator.bestIndex) {
        accumulator.bestIndex = index;
        accumulator.bestRule = matchers[index].rule;
      }
    } else {
      accumulators.set(key, {
        entry,
        count: 1,
        expectedAll: index !== -1,
        bestIndex: index === -1 ? Infinity : index,
        bestRule: index === -1 ? undefined : matchers[index].rule,
      });
    }
  }
  return [...accumulators.values()]
    .map(({ entry, count, expectedAll, bestRule }) =>
      expectedAll
        ? { ...entry, count, expected: true, expectedBy: bestRule }
        : { ...entry, count, expected: false },
    )
    .sort(compareAggregated);
}

/** How a protocol appears in the host tables, matching the rule kind that would
 *  permit it. */
const RULE_TYPE: Record<TrafficEvent["protocol"], string> = {
  https: "HTTPS",
  http: "HTTP",
  tls: "TLS",
  tcp: "IP",
  dns: "DNS",
};

/** Reduce an event to the host row a rule is written against. A dns event has
 *  no port, having connected to nothing. */
export function toHostRow(event: TrafficEvent): LogEntry {
  return {
    host: event.host,
    port: event.port === undefined ? "-" : String(event.port),
    ruleType: RULE_TYPE[event.protocol],
    reason: event.reason ?? "-",
  };
}

export interface ReducedTimeline {
  passed: AggregatedEntry[];
  blocked: AnnotatedBlockedRow[];
  failed: AggregatedEntry[];
  /** Raw blocked-event count, so it can exceed blocked.length. */
  blockedCount: number;
}

/**
 * Turn a timeline into the report's three host tables, the reduction both
 * engines share. `discovery` and `incomplete` events reach neither table (no
 * rule decided them; the timeline still keeps them). A lookup a connection
 * already covers is dropped, and a failed connection is kept apart from
 * refusals (see TrafficAction).
 *
 * Blocked events are kept whole rather than reduced to host rows first:
 * annotateKnownBlocked matches a URL rule against the method and path a host
 * row would have thrown away.
 */
export function reduceTimeline(
  timeline: TrafficEvent[],
  knownBlockedRules: string[],
): ReducedTimeline {
  const passedRows: LogEntry[] = [];
  const blockedEvents: TrafficEvent[] = [];
  const failedRows: LogEntry[] = [];
  const connected = connectedHosts(timeline);
  for (const event of timeline) {
    if (event.action === "discovery" || event.action === "incomplete") continue;
    if (isRedundantDns(event, connected)) continue;
    if (event.action === "failed") failedRows.push(toHostRow(event));
    else if (event.action === "block") blockedEvents.push(event);
    else passedRows.push(toHostRow(event));
  }
  return {
    passed: aggregate(passedRows),
    blocked: annotateKnownBlocked(blockedEvents, knownBlockedRules),
    failed: aggregate(failedRows),
    blockedCount: blockedEvents.length,
  };
}

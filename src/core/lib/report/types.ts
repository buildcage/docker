import type { ProxyDroppedLogs } from "../docker/proxy-dropped-logs.ts";
import type { AggregatedEntry } from "../log/aggregate.ts";
import type { TrafficEvent } from "../log/traffic-event.ts";
import type { AnnotatedBlockedRow } from "./build/aggregate.ts";

/** Echoed back verbatim from the action's configuration rather than
 *  re-derived, since nothing else reflects what was configured. */
export interface GenReportParameters {
  mode: string;
  allowedHttpsRules: string[];
  allowedHttpRules: string[];
  allowedIpRules: string[];
  allowedTlsRules: string[];
  /** One rule per entry, as written. */
  allowedUrlRules: string[];
  knownBlockedRules: string[];
}

/** What the report asks the running proxy container, alongside its logs. */
export interface ServiceHealth {
  droppedLogs: ProxyDroppedLogs;
  /** Whether the resolver answered its health check (resolver-health.ts). */
  resolverAnswered: boolean;
}

export interface ReportDataCommon {
  parameters: GenReportParameters;

  /** restrict mode's allowed traffic or audit mode's audited traffic;
   *  which heading applies is decided from parameters.mode. Never annotated:
   *  known-blocked-rules only ever marks a blocked row. */
  passed: AggregatedEntry[];

  /** Aggregated blocked-domain rows, already annotated against
   *  knownBlockedRules. Can be non-empty even in audit mode. */
  blocked: AnnotatedBlockedRow[];

  /** Connections the rules allowed that then did not complete: the origin
   *  broke off, or the upstream resolver could not answer the name. Tabulated
   *  apart from `blocked` and left out of `blockedCount`; see TrafficAction. */
  failed: AggregatedEntry[];

  /** Raw blocked-event count: log lines rather than aggregated rows, so it
   *  can be larger than blocked.length. */
  blockedCount: number;

  /** False iff the logs are not a complete record of the run: either log's
   *  beginning is gone or it is empty, a line of ours could not be read (each
   *  scan's headIntact and unparsed), the proxy dropped a line or could not
   *  say whether it did (proxy-dropped-logs.ts), the resolver did not answer,
   *  or the proxy or the resolver restarted. Anything written from this flag
   *  names what `proxyAnswered`, `resolverAnswered` and `restarts` establish
   *  and has to list the rest as possibilities, since the flag itself does
   *  not say which applied. The report fails closed rather than passing off
   *  what survived as everything. */
  logLooksPlausible: boolean;

  /** False when the proxy did not answer the report: it stopped during the run
   *  and stayed down, or hung. */
  proxyAnswered: boolean;

  /** False when the resolver did not answer the report: it stopped during the
   *  run and stayed down, or hung. A lookup it never received leaves no line. */
  resolverAnswered: boolean;

  /** How many times each service started again after it stopped mid-run. A
   *  connection still open when the proxy stopped never gets its line, and the
   *  proxy's dropped-line count starts over, so a restart leaves the record short. */
  restarts: { proxy: number; resolver: number };

  /** Every connection and blocked name, oldest first. Nothing is attributable
   *  to one RUN step or one command: the proxy log carries no identifier for
   *  either, so one timeline is the only structure available, and the more
   *  useful one: a block reads in the context of what the build or step was
   *  doing when it happened. */
  timeline: TrafficEvent[];

  /** Seconds since the epoch the proxy itself started, so the report can show
   *  every event's time relative to it. Undefined when the proxy log carried no
   *  startup marker to read it from. */
  startedAt: number | undefined;
}

export interface UniversalReportData extends ReportDataCommon {
  engine: "universal";
}

/** The inspect engine decrypts, so its timeline carries the method and full URL
 *  of every request, blocked ones included; universal's carries only host,
 *  port and bytes. */
export interface InspectReportData extends ReportDataCommon {
  engine: "inspect";
}

export type ReportData = UniversalReportData | InspectReportData;

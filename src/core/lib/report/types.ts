import type { AggregatedEntry } from "../log/aggregate.ts";
import type { AnnotatedBlockedRow } from "./build/aggregate.ts";
import type { TrafficEvent } from "../log/traffic-event.ts";

/** Echoed back verbatim rather than re-derived: only the container's own
 *  env (or, for run, its own action input) reflects what was configured. */
export interface GenReportParameters {
  mode: string;
  allowedHttpsRules: string[];
  allowedHttpRules: string[];
  allowedIpRules: string[];
  allowedTlsRules: string[];
  /** Also drives whether the "Expected" column is shown (length > 0). */
  knownBlockedRules: string[];
}

export interface ReportDataCommon {
  parameters: GenReportParameters;

  /** restrict mode's allowed traffic or audit mode's audited traffic;
   *  which heading applies is decided from parameters.mode. Never annotated:
   *  known_blocked_rules only ever marks a blocked row. */
  passed: AggregatedEntry[];

  /** Aggregated blocked-domain rows, already annotated against
   *  knownBlockedRules. Can be non-empty even in audit mode. */
  blocked: AnnotatedBlockedRow[];

  /** Connections the rules allowed that then did not complete: the origin
   *  broke off, or the upstream resolver could not answer the name. Tabulated
   *  apart from `blocked` and left out of `blockedCount`; see TrafficAction. */
  failed: AggregatedEntry[];

  /** Raw blocked-event count: both engines count log lines rather than
   *  aggregated rows, so it can be larger than blocked.length. */
  blockedCount: number;

  /** False iff the log is not a complete record of the run: its beginning is
   *  gone, a decision line could not be read, it never carried a trace of a
   *  real one (haproxy.ts's headIntact and unparsed), or the proxy dropped a
   *  line or could not say whether it did (proxy-dropped-logs.ts). Anything written from
   *  this flag has to name every one of them, since the flag itself does not say
   *  which applied. The report fails closed rather than passing off what
   *  survived as everything. */
  logLooksPlausible: boolean;

  /** Every connection and refused name, oldest first. Nothing is attributable
   *  to one RUN step or one command: the proxy log carries no identifier for
   *  either, so one timeline is the only structure available, and the more
   *  useful one: a refusal reads in the context of what the build or step was
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
 *  of every request, refused ones included; universal's carries only host,
 *  port and bytes. */
export interface InspectReportData extends ReportDataCommon {
  engine: "inspect";
}

export type ReportData = UniversalReportData | InspectReportData;

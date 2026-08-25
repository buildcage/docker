import type { HostTableRow } from "./render/host-table.ts";
import type { AnnotatedBlockedRow } from "./build/aggregate.ts";
import type { VertexAllowedEntry } from "../log/vertex.ts";
import type { TrafficEvent } from "../log/traffic-event.ts";

/** Echoed back verbatim rather than re-derived — only the container's own
 *  env (or, for run, its own action input) reflects what was configured. */
export interface GenReportParameters {
  mode: string;
  allowedHttpsRules: string[];
  allowedHttpRules: string[];
  allowedIpRules: string[];
  /** Also drives whether the "Expected" column is shown (length > 0). */
  knownBlockedRules: string[];
}

export interface ReportDataCommon {
  parameters: GenReportParameters;

  /** restrict mode's allowed traffic or audit mode's audited traffic —
   *  which heading applies is decided from parameters.mode. */
  passed: HostTableRow[];

  /** Aggregated blocked-domain rows, already annotated against
   *  knownBlockedRules. Can be non-empty even in audit mode. */
  blocked: AnnotatedBlockedRow[];

  /** Raw blocked-event count — can differ from blocked.length for the
   *  transparent engine (pre-aggregation log line count). */
  blockedCount: number;

  /** False iff the log looks structurally implausible for a real run (no
   *  non-buildcage/non-denial content at all) — see haproxy.ts's
   *  hasNonBuildcageContent / buildkitd.ts's hasNonDenialContent.
   *  Used to fail closed on a suspiciously empty log instead of treating it
   *  as "nothing was blocked". */
  logLooksPlausible: boolean;
}

export interface TransparentReportData extends ReportDataCommon {
  engine: "transparent";
}

/** Discriminated union (keyed on `engine`) rather than an optional field,
 *  so `report.engine === "explicit"` narrows `proxyLogs` to present. */
export interface ExplicitReportData extends ReportDataCommon {
  engine: "explicit";
  proxyLogs: {
    /** Per-build, per-RUN-step allowed request breakdown. */
    builds: VertexAllowedEntry[][];
    /** Denied requests aren't attributable to a RUN step and come from a
     *  different source (buildkitd's log, not buildctl), hence separate. */
    denied: DeniedEntry[];
  };
}

/** The inspect engine decrypts, so it has the method and full URL of every
 *  request, refused ones included. Nothing is attributable to a RUN step: the
 *  proxy log carries no vertex identifier, unlike the explicit engine's
 *  buildkitd log. One timeline is therefore the only structure available, and
 *  the more useful one: a refusal reads in the context of what the build was
 *  doing when it happened. */
export interface InspectReportData extends ReportDataCommon {
  engine: "inspect";
  /** Every request, passthrough and refused name, oldest first. */
  timeline: TrafficEvent[];
  /** Seconds since the epoch the proxy itself started, so the report can
   *  show every event's time relative to it. Undefined exactly when
   *  logLooksPlausible is false -- there was no startup marker to read it
   *  from. */
  startedAt: number | undefined;
}

export type ReportData = TransparentReportData | ExplicitReportData | InspectReportData;

export interface DeniedEntry {
  url: string;
  timestamp: string;
}

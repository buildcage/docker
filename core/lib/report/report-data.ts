import type { HostTableRow } from "./host-table.ts";
import type { AnnotatedBlockedRow } from "./known-blocked.ts";
import type { VertexAllowedEntry } from "../log/vertex-log.ts";

/**
 * Values setup/run configured this container/step with, echoed back
 * verbatim rather than re-derived — only the container's own env (or, for
 * run, its own action input) reflects what was actually configured.
 */
export interface GenReportParameters {
  /** PROXY_MODE's raw value — always a real string ("restrict"/"audit"). */
  mode: string;
  allowedHttpsRules: string[];
  allowedHttpRules: string[];
  allowedIpRules: string[];
  /** The exact rule set already used to annotate blocked[].expected below —
   *  also drives whether the "Expected" column is shown at all
   *  (knownBlockedRules.length > 0). */
  knownBlockedRules: string[];
}

export interface ReportDataCommon {
  parameters: GenReportParameters;

  /** Domains that passed: restrict mode's allowed traffic, or audit mode's
   *  audited traffic — which heading to render under is decided from
   *  parameters.mode, not from this field's own shape. Always present
   *  (possibly []). "Nothing to report" is expressed by passed/blocked/
   *  blockedCount all being empty/zero, not a dedicated flag. */
  passed: HostTableRow[];

  /** Aggregated blocked-domain rows, already annotated against
   *  knownBlockedRules (each row's expected: boolean). Can be non-empty
   *  even in audit mode (e.g. DNS/protocol errors) — not a pass/fail
   *  signal by itself. */
  blocked: AnnotatedBlockedRow[];

  /** Raw blocked-event count: for the transparent engine this is pre-
   *  aggregation BLOCKED log line count; for explicit it equals the
   *  aggregated row count (buildkitd's denial log has no finer
   *  granularity). Can differ from blocked.length (transparent only). */
  blockedCount: number;
}

/** Transparent has no raw/per-request log concept — domain aggregation is
 *  considered sufficient, so it carries no proxyLogs field at all. */
export interface TransparentReportData extends ReportDataCommon {
  engine: "transparent";
}

/** Explicit-only. A discriminated union (keyed on `engine`) rather than an
 *  optional field lets callers narrow `report.proxyLogs` to "definitely
 *  present" just by checking `report.engine === "explicit"`. */
export interface ExplicitReportData extends ReportDataCommon {
  engine: "explicit";
  proxyLogs: {
    /** Per-build, per-RUN-step allowed request breakdown, sourced from
     *  buildctl debug histories/logs. */
    builds: VertexAllowedEntry[][];
    /** Chronological denied-request list from buildkitd's own denial log —
     *  not attributable to a specific RUN step, and sourced differently
     *  (buildkitd's structured log, not buildctl's API), hence its own
     *  field rather than folded into `builds`. */
    denied: DeniedEntry[];
  };
}

export type ReportData = TransparentReportData | ExplicitReportData;

export interface DeniedEntry {
  url: string;
  timestamp: string;
}

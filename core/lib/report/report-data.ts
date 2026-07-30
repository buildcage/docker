import type { HostTableRow } from "./host-table.ts";
import type { AnnotatedBlockedRow } from "./known-blocked.ts";
import type { VertexAllowedEntry } from "../log/vertex-log.ts";

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
   *  non-buildcage/non-denial content at all) — see haproxy-log-parser.ts's
   *  hasNonBuildcageContent / buildkitd-log-parser.ts's hasNonDenialContent.
   *  Used by known-blocked.ts to fail closed on a suspiciously empty log
   *  instead of treating it as "nothing was blocked". */
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

export type ReportData = TransparentReportData | ExplicitReportData;

export interface DeniedEntry {
  url: string;
  timestamp: string;
}

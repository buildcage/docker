import type { HostTableRow } from "./host-table.ts";
import type { BlockedRow } from "./known-blocked.ts";

/**
 * Shape of report.js's JSON output, shared by run/src/lib/report.ts (transparent
 * engine only) and report/src/main.ts (both engines — deniedTimeline is only
 * ever present in the explicit engine's report, see report/src/main.ts's
 * isExplicit check).
 */
export interface ReportSections {
  audited?: HostTableRow[];
  allowed?: HostTableRow[];
  blocked?: BlockedRow[];
}

export interface ReportData {
  mode: string | null;
  sections?: ReportSections;
  blockedCount?: number;
  deniedTimeline?: DeniedEntry[];
}

export interface DeniedEntry {
  url: string;
  timestamp: string;
}

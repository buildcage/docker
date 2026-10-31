/**
 * Report-shaped test data more than one report test needs: the parameter
 * defaults a case starts from, a run nothing interrupted, and the blocked rows
 * one known_blocked_rule covers. Kept here so a new field on
 * GenReportParameters is written once.
 */
import type { ProxyDroppedLogs } from "../docker/proxy-dropped-logs.ts";
import type { AnnotatedBlockedRow } from "../report/build/aggregate.ts";
import type { Interruptions } from "../report/outcome/blocked-outcome.ts";
import type { GenReportParameters, ServiceHealth } from "../report/types.ts";

/** A proxy that answered and dropped nothing. */
export const NONE_DROPPED: ProxyDroppedLogs = { answered: true, count: 0 };

/** A proxy that answered and dropped nothing, and a resolver that answered. */
export const HEALTHY: ServiceHealth = { droppedLogs: NONE_DROPPED, resolverAnswered: true };

/** A run in which both services answered and nothing restarted. */
export const UNINTERRUPTED: Interruptions = {
  proxyAnswered: true,
  resolverAnswered: true,
  restarts: { proxy: 0, resolver: 0 },
};

/** Restrict mode carrying only the rules a case names. */
export function reportParams(overrides: Partial<GenReportParameters> = {}): GenReportParameters {
  return {
    mode: "restrict",
    allowedHttpsRules: [],
    allowedHttpRules: [],
    allowedIpRules: [],
    allowedTlsRules: [],
    allowedUrlRules: [],
    knownBlockedRules: [],
    ...overrides,
  };
}

/** Two hosts one known_blocked_rule covers, so they render as one folded row. */
export const expectedRows: AnnotatedBlockedRow[] = [
  {
    host: "a.sury.org",
    port: "443",
    ruleType: "HTTPS",
    reason: "https-not-allowed",
    count: 1,
    expected: true,
    expectedBy: "*.sury.org:*",
  },
  {
    host: "b.sury.org",
    port: "443",
    ruleType: "HTTPS",
    reason: "https-not-allowed",
    count: 1,
    expected: true,
    expectedBy: "*.sury.org:*",
  },
];

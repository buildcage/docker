/**
 * Report-shaped test data more than one report test needs: the parameter
 * defaults a case starts from, and the blocked rows one known_blocked_rule
 * covers. Kept here so a new field on GenReportParameters is written once.
 */
import type { AnnotatedBlockedRow } from "../report/build/aggregate.ts";
import type { GenReportParameters } from "../report/types.ts";

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

/** Two hosts one known_blocked_rule covers, so the Expected column and the
 *  folded row both render. */
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

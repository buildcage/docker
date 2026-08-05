import type { ExpectedFlag } from "../build/aggregate.ts";

/**
 * Decide whether blocked connections should fail the step.
 *
 * `blockedRows` must already be annotated via annotateKnownBlocked. Uses
 * per-row matching rather than count arithmetic because `blockedCount`'s
 * meaning differs by proxy engine, so subtracting summed row counts from it
 * isn't reliable. An empty `blockedRows` with a nonzero `blockedCount` is
 * treated as unexpected too (fail closed).
 */
export interface BlockedOutcome {
  level: "none" | "notice" | "error";
  shouldFail: boolean;
}

export interface DetermineBlockedOutcomeOptions {
  isAudit: boolean;
  failOnBlocked: boolean;
  blockedCount: number;
  blockedRows: ExpectedFlag[];
  /** See ReportDataCommon.logLooksPlausible. */
  logLooksPlausible: boolean;
}

export function determineBlockedOutcome({
  isAudit,
  failOnBlocked,
  blockedCount,
  blockedRows,
  logLooksPlausible,
}: DetermineBlockedOutcomeOptions): BlockedOutcome {
  if (!blockedCount) {
    // A log with no recognizable trace of a real proxy run is treated as
    // suspicious rather than as "nothing was blocked" — this is a
    // heuristic against a naive wholesale-erasure tamper, not a guarantee
    // against a deliberate, format-aware forgery.
    if (logLooksPlausible) return { level: "none", shouldFail: false };
    if (isAudit) return { level: "notice", shouldFail: false };
    return failOnBlocked
      ? { level: "error", shouldFail: true }
      : { level: "notice", shouldFail: false };
  }
  if (isAudit) return { level: "notice", shouldFail: false };
  const hasUnexpected = blockedRows.length === 0 || blockedRows.some((row) => !row.expected);
  if (failOnBlocked && hasUnexpected) return { level: "error", shouldFail: true };
  return { level: "notice", shouldFail: false };
}

/**
 * Build the annotation message text for a blocked-connections check.
 *
 * In audit mode the text always stays the fixed-format base string,
 * regardless of known_blocked_rules matching — audit mode's pass/fail
 * outcome is unaffected by matching (see determineBlockedOutcome), so
 * varying the notice text there would be misleading and would silently
 * break any tooling that matches the old fixed-format notice.
 *
 */
export interface BuildBlockedMessageOptions {
  blockedCount: number;
  blockedRows: ExpectedFlag[];
  engineLabel: "sandbox" | "proxy";
  isAudit: boolean;
}

export function buildBlockedMessage({
  blockedCount,
  blockedRows,
  engineLabel,
  isAudit,
}: BuildBlockedMessageOptions): string {
  const base = `${blockedCount} blocked connection(s) detected by buildcage ${engineLabel}`;
  if (isAudit) return base;
  const unexpected = blockedRows.filter((row) => !row.expected).length;
  if (unexpected === blockedRows.length) return base; // nothing matched (incl. known_blocked_rules unset)
  if (unexpected === 0) return `${base}, all matched known_blocked_rules (expected)`;
  return `${base} (${unexpected} of ${blockedRows.length} distinct blocked host(s) unmatched by known_blocked_rules)`;
}

export interface DescribedBlockedOutcome extends BlockedOutcome {
  message: string;
}

export interface DescribeBlockedOutcomeOptions {
  isAudit: boolean;
  failOnBlocked: boolean;
  blockedCount: number;
  blockedRows: ExpectedFlag[];
  logLooksPlausible: boolean;
  engineLabel: "sandbox" | "proxy";
}

/** Combines the pass/fail decision with its annotation message. */
export function describeBlockedOutcome({
  isAudit,
  failOnBlocked,
  blockedCount,
  blockedRows,
  logLooksPlausible,
  engineLabel,
}: DescribeBlockedOutcomeOptions): DescribedBlockedOutcome {
  const outcome = determineBlockedOutcome({
    isAudit,
    failOnBlocked,
    blockedCount,
    blockedRows,
    logLooksPlausible,
  });
  const message = buildBlockedMessage({ blockedCount, blockedRows, engineLabel, isAudit });
  return { ...outcome, message };
}
